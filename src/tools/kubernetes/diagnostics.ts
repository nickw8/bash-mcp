/**
 * Kubernetes diagnostic tools.
 *
 * Higher-level "what's wrong?" tools that collapse a multi-call investigation
 * (get → describe → logs → events) into a single structured answer of the
 * form { status, likelyCauses, suggestedNextCommands, evidence }. The pure
 * classification lives in diagnose.ts; these are thin kubectl + parser glue.
 *
 * A kubectl that ran and failed is captured in `evidence` as a partial result
 * rather than surfaced as a hard error, so the agent always gets something
 * actionable; only a kubectl that never ran (`isUnrunnable`) is an error.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execJson, TIMEOUT } from "#exec";
import { kubectlContext, namespaceSchema } from "#kube-args";
import {
  applyBudget,
  budgetSchema,
  isUnrunnable,
  triageSchema,
  unknownTriage,
} from "#parsers";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import {
  type Diagnosis,
  diagnoseDeployment,
  diagnosePod,
  type KubeEvent,
  summarizeEvents,
} from "./diagnose.js";
import type { KubeList, KubeResource } from "./parse.js";

/** Return a Diagnosis as an MCP response (explicit literal for ok()'s type). */
function okDiagnosis(d: Diagnosis) {
  return ok({
    status: d.status,
    likelyCauses: d.likelyCauses,
    suggestedNextCommands: d.suggestedNextCommands,
    evidence: d.evidence,
  });
}

/** Register the kube diagnostic tools on the MCP server. */
export function registerKubeDiagnosticTools(server: McpServer) {
  // ── kube_diagnose_pod ───────────────────────────────────────────────
  defineTool(
    server,
    "kube_diagnose_pod",
    {
      title: "Diagnose a pod",
      equivalentCommands: [
        "kubectl get pod <pod> -n <ns> -o json",
        "kubectl describe pod <pod> -n <ns>",
        "kubectl logs <pod> -n <ns>",
      ],
      description:
        "Diagnose why a pod is unhealthy in one call. Returns status, likely causes, " +
        "suggested next commands, and evidence (CrashLoopBackOff/ImagePullBackOff/OOMKilled/Unschedulable/restarts).",
      inputSchema: {
        pod: z.string().describe("Pod name"),
        namespace: namespaceSchema,
        context: z.string().optional().describe("Kubectl context"),
      },
      outputSchema: triageSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ pod, namespace, context }) => {
      const res = await execJson<KubeResource>(
        "kubectl",
        [
          "get",
          "pod",
          pod,
          "-n",
          namespace,
          "-o",
          "json",
          ...kubectlContext(context),
        ],
        { timeout: TIMEOUT.INFRA },
      );
      if (res.error) {
        if (isUnrunnable(res.detail)) return err(res.error, {}, res.detail);
        return okDiagnosis(
          unknownTriage(`kubectl get pod failed: ${res.error}`, [
            `kube_events_summary namespace=${namespace}`,
          ]),
        );
      }
      return okDiagnosis(diagnosePod(res.data ?? {}));
    },
  );

  // ── kube_pod_failure_summary ────────────────────────────────────────
  defineTool(
    server,
    "kube_pod_failure_summary",
    {
      title: "Summarize failing pods",
      equivalentCommands: [
        "kubectl get pods -n <ns> -o json",
        "kubectl describe pod <pod> -n <ns>",
      ],
      description:
        "List unhealthy pods in a namespace with their failure reason and evidence — one call instead of get + describe per pod.",
      inputSchema: {
        namespace: namespaceSchema,
        allNamespaces: z.boolean().optional().describe("Search all namespaces"),
        context: z.string().optional().describe("Kubectl context"),
        ...budgetSchema,
      },
      outputSchema: {
        ...triageSchema,
        pods: z.array(
          z.object({
            name: z.string(),
            namespace: z.string(),
            status: z.string(),
            evidence: z.array(z.string()),
          }),
        ),
        total: z.number().optional(),
        truncated: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ namespace, allNamespaces, context, detailLevel, maxItems }) => {
      const scope = allNamespaces ? ["--all-namespaces"] : ["-n", namespace];
      const res = await execJson<KubeList>(
        "kubectl",
        ["get", "pods", ...scope, "-o", "json", ...kubectlContext(context)],
        { timeout: TIMEOUT.INFRA },
      );
      if (res.error) {
        if (isUnrunnable(res.detail)) return err(res.error, {}, res.detail);
        return ok({
          ...unknownTriage(`kubectl get pods failed: ${res.error}`),
          pods: [],
        });
      }

      const healthy = new Set(["Running", "Succeeded"]);
      const allPods = (res.data?.items ?? [])
        .map((p) => ({ p, d: diagnosePod(p) }))
        .filter(({ d }) => !healthy.has(d.status) || d.evidence.length > 0)
        .map(({ p, d }) => ({
          name: p.metadata?.name ?? "",
          namespace: p.metadata?.namespace ?? namespace,
          status: d.status,
          evidence: d.evidence,
        }));

      const hasBudget = detailLevel !== undefined || maxItems !== undefined;
      const {
        items: pods,
        truncated,
        total,
      } = applyBudget(allPods, {
        detailLevel,
        maxItems,
      });

      // status/causes reflect the full set; evidence + pods are the budgeted view.
      const base = {
        status: allPods.length ? "Unhealthy" : "Healthy",
        likelyCauses: allPods.length
          ? ["One or more pods are failing; see per-pod status and evidence."]
          : [],
        suggestedNextCommands: allPods.length
          ? [
              `kube_diagnose_pod pod=${pods[0]?.name} namespace=${pods[0]?.namespace}`,
            ]
          : [],
        evidence: pods.map((p) => `${p.namespace}/${p.name}: ${p.status}`),
        pods,
      };
      return ok(hasBudget ? { ...base, total, truncated } : base);
    },
  );

  // ── kube_deployment_status ──────────────────────────────────────────
  defineTool(
    server,
    "kube_deployment_status",
    {
      title: "Deployment rollout status",
      equivalentCommands: [
        "kubectl rollout status deployment/<name> -n <ns>",
        "kubectl get deployment <name> -n <ns> -o json",
      ],
      description:
        "Report a deployment's rollout health (ready/desired replicas, conditions) as a structured diagnosis.",
      inputSchema: {
        name: z.string().describe("Deployment name"),
        namespace: namespaceSchema,
        context: z.string().optional().describe("Kubectl context"),
      },
      outputSchema: triageSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ name, namespace, context }) => {
      const res = await execJson<KubeResource>(
        "kubectl",
        [
          "get",
          "deployment",
          name,
          "-n",
          namespace,
          "-o",
          "json",
          ...kubectlContext(context),
        ],
        { timeout: TIMEOUT.INFRA },
      );
      if (res.error) {
        if (isUnrunnable(res.detail)) return err(res.error, {}, res.detail);
        return okDiagnosis(
          unknownTriage(`kubectl get deployment failed: ${res.error}`),
        );
      }
      return okDiagnosis(diagnoseDeployment(res.data ?? {}));
    },
  );

  // ── kube_events_summary ─────────────────────────────────────────────
  defineTool(
    server,
    "kube_events_summary",
    {
      title: "Summarize warning events",
      description:
        "Summarize Warning events in a namespace (grouped by reason, ordered by count) instead of scrolling raw kubectl get events.",
      equivalentCommands: ["kubectl get events -n <ns>"],
      inputSchema: {
        namespace: namespaceSchema,
        allNamespaces: z.boolean().optional().describe("Search all namespaces"),
        context: z.string().optional().describe("Kubectl context"),
        ...budgetSchema,
      },
      outputSchema: {
        ...triageSchema,
        total: z.number().optional(),
        truncated: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ namespace, allNamespaces, context, detailLevel, maxItems }) => {
      const scope = allNamespaces ? ["--all-namespaces"] : ["-n", namespace];
      const res = await execJson<{ items: KubeEvent[] }>(
        "kubectl",
        ["get", "events", ...scope, "-o", "json", ...kubectlContext(context)],
        { timeout: TIMEOUT.INFRA },
      );
      if (res.error) {
        if (isUnrunnable(res.detail)) return err(res.error, {}, res.detail);
        return okDiagnosis(
          unknownTriage(`kubectl get events failed: ${res.error}`),
        );
      }
      const diag = summarizeEvents(res.data?.items ?? []);
      const hasBudget = detailLevel !== undefined || maxItems !== undefined;
      const {
        items: evidence,
        truncated,
        total,
      } = applyBudget(diag.evidence, {
        detailLevel,
        maxItems,
      });
      const base = { ...diag, evidence };
      return ok(hasBudget ? { ...base, total, truncated } : base);
    },
  );
}
