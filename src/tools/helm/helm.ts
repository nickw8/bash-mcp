/**
 * Helm Tools
 *
 * Wraps helm commands (list, status, get values) and returns structured
 * JSON. Uses helm's native JSON output mode for consistent parsing.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execJson, TIMEOUT } from "#exec";
import {
  allNamespacesSchema,
  contextSchema,
  helmContext,
  namespaceSchema,
  namespaceScope,
} from "#kube-args";
import { triageRun, triageSchema } from "#parsers";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import type { HelmHistoryEntry, HelmRelease, HelmStatus } from "./payload.js";
import { triageRelease } from "./triage.js";

/** Register all Helm tools on the MCP server. */
export function registerHelmTools(server: McpServer) {
  // ── helm list ───────────────────────────────────────────────────────
  defineTool(
    server,
    "helm_list",
    {
      title: "Helm releases",
      description:
        "List Helm releases with status, chart, and app version. Structured output.",
      equivalentCommands: ["helm list -A -o json"],
      inputSchema: {
        namespace: z.string().optional().describe("Namespace (omit for all)"),
        allNamespaces: allNamespacesSchema,
        filter: z.string().optional().describe("Filter by release name regex"),
        context: contextSchema,
      },
      outputSchema: {
        releases: z.array(
          z.object({
            name: z.string(),
            namespace: z.string(),
            revision: z.number(),
            status: z.string(),
            chart: z.string(),
            appVersion: z.string(),
            updated: z.string(),
          }),
        ),
        count: z.number(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ namespace, allNamespaces, filter, context }) => {
      const args = ["list", "-o", "json"];
      args.push(...namespaceScope(namespace, allNamespaces));
      if (filter) args.push("--filter", filter);
      args.push(...helmContext(context));

      const result = await execJson<HelmRelease[]>("helm", args, {
        timeout: TIMEOUT.INFRA,
      });

      if (result.error) {
        return err(result.error, {}, result.detail);
      }

      const releases = (result.data ?? []).map((r) => ({
        name: r.name ?? "",
        namespace: r.namespace ?? "",
        revision: parseInt(r.revision ?? "0", 10),
        status: r.status ?? "",
        chart: r.chart ?? "",
        appVersion: r.app_version ?? "",
        updated: r.updated ?? "",
      }));

      return ok({ releases, count: releases.length });
    },
  );

  // ── helm status ─────────────────────────────────────────────────────
  defineTool(
    server,
    "helm_status",
    {
      title: "Helm release status",
      description: "Get detailed status of a Helm release.",
      equivalentCommands: ["helm status <release> -n <ns>"],
      inputSchema: {
        release: z.string().describe("Release name"),
        namespace: namespaceSchema,
        context: contextSchema,
      },
      outputSchema: {
        name: z.string(),
        namespace: z.string(),
        revision: z.number(),
        status: z.string(),
        description: z.string(),
        lastDeployed: z.string(),
        notes: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ release, namespace, context }) => {
      const args = ["status", release, "-n", namespace, "-o", "json"];
      args.push(...helmContext(context));

      const result = await execJson<HelmStatus>("helm", args, {
        timeout: TIMEOUT.INFRA,
      });

      if (result.error || !result.data) {
        return err(
          result.error ?? "helm status: no data",
          {
            name: release,
            namespace,
            status: "error",
            description: result.error ?? "",
          },
          result.detail,
        );
      }

      const d = result.data;
      return ok({
        name: d.name ?? release,
        namespace: d.namespace ?? namespace,
        revision: d.version ?? 0,
        status: d.info?.status ?? "",
        description: d.info?.description ?? "",
        lastDeployed: d.info?.last_deployed ?? "",
        notes: (d.info?.notes ?? "").slice(0, 500),
      });
    },
  );

  // ── helm values ─────────────────────────────────────────────────────
  defineTool(
    server,
    "helm_values",
    {
      title: "Helm release values",
      description:
        "Get the computed values for a Helm release as structured data.",
      equivalentCommands: ["helm get values <release> -n <ns>"],
      inputSchema: {
        release: z.string().describe("Release name"),
        namespace: namespaceSchema,
        allValues: z
          .boolean()
          .optional()
          .describe("Include chart defaults (not just user-supplied)"),
        context: contextSchema,
      },
      outputSchema: {
        values: z.record(z.unknown()),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ release, namespace, allValues, context }) => {
      const args = ["get", "values", release, "-n", namespace, "-o", "json"];
      if (allValues) args.push("--all");
      args.push(...helmContext(context));

      const result = await execJson<Record<string, unknown>>("helm", args, {
        timeout: TIMEOUT.INFRA,
      });

      if (result.error) {
        return err(result.error, {}, result.detail);
      }

      return ok({ values: result.data ?? {} });
    },
  );

  // ── helm release triage ─────────────────────────────────────────────
  defineTool(
    server,
    "helm_release_triage",
    {
      title: "Helm release triage",
      equivalentCommands: [
        "helm status <release> -n <ns>",
        "helm history <release> -n <ns>",
      ],
      description:
        "Diagnose a Helm release's health in one call: combines helm status + helm history into " +
        "current status, likely causes, suggested next commands, and recent-revision evidence.",
      inputSchema: {
        release: z.string().describe("Release name"),
        namespace: namespaceSchema,
        context: contextSchema,
      },
      outputSchema: {
        healthy: z.boolean(),
        revision: z.number(),
        revisions: z.number(),
        ...triageSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ release, namespace, context }) => {
      const ctxArgs = helmContext(context);
      return triageRun({
        probe: () =>
          execJson<HelmStatus>(
            "helm",
            ["status", release, "-n", namespace, "-o", "json", ...ctxArgs],
            { timeout: TIMEOUT.INFRA },
          ),
        empty: { healthy: false, revision: 0, revisions: 0 },
        failure: "helm status failed",
        suggestedNextCommands: [`helm_list namespace=${namespace}`],
        classify: async (status) => {
          // History is best-effort — a missing history shouldn't fail the triage.
          const hist = await execJson<HelmHistoryEntry[]>(
            "helm",
            ["history", release, "-n", namespace, "-o", "json", ...ctxArgs],
            { timeout: TIMEOUT.INFRA },
          );
          return triageRelease(status, hist.data ?? []);
        },
      });
    },
  );
}
