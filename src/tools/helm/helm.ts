/**
 * Helm Tools
 *
 * Wraps helm commands (list, status, get values) and returns structured
 * JSON. Uses helm's native JSON output mode for consistent parsing.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execJson, TIMEOUT } from "#exec";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import {
  type HelmHistoryEntry,
  type HelmStatusInfo,
  triageRelease,
} from "./triage.js";

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
      inputSchema: {
        namespace: z.string().optional().describe("Namespace (omit for all)"),
        allNamespaces: z.boolean().optional().describe("All namespaces"),
        filter: z.string().optional().describe("Filter by release name regex"),
        context: z.string().optional().describe("Kubectl context"),
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
    },
    async ({ namespace, allNamespaces, filter, context }) => {
      const args = ["list", "-o", "json"];
      if (namespace) args.push("-n", namespace);
      if (allNamespaces) args.push("--all-namespaces");
      if (filter) args.push("--filter", filter);
      if (context) args.push("--kube-context", context);

      const result = await execJson<HelmRelease[]>("helm", args, {
        timeout: TIMEOUT.INFRA,
      });

      if (result.error) {
        return err(result.error, { releases: [], count: 0 });
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
      inputSchema: {
        release: z.string().describe("Release name"),
        namespace: z
          .string()
          .optional()
          .default("default")
          .describe("Namespace"),
        context: z.string().optional().describe("Kubectl context"),
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
    },
    async ({ release, namespace, context }) => {
      const args = [
        "status",
        release,
        "-n",
        namespace ?? "default",
        "-o",
        "json",
      ];
      if (context) args.push("--kube-context", context);

      const result = await execJson<HelmStatus>("helm", args, {
        timeout: TIMEOUT.INFRA,
      });

      if (result.error || !result.data) {
        return err(result.error ?? "helm status: no data", {
          name: release,
          namespace: namespace ?? "default",
          revision: 0,
          status: "error",
          description: result.error ?? "",
          lastDeployed: "",
          notes: "",
        });
      }

      const d = result.data;
      return ok({
        name: d.name ?? release,
        namespace: d.namespace ?? namespace ?? "default",
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
      inputSchema: {
        release: z.string().describe("Release name"),
        namespace: z
          .string()
          .optional()
          .default("default")
          .describe("Namespace"),
        allValues: z
          .boolean()
          .optional()
          .describe("Include chart defaults (not just user-supplied)"),
        context: z.string().optional().describe("Kubectl context"),
      },
      outputSchema: {
        values: z.record(z.unknown()),
      },
    },
    async ({ release, namespace, allValues, context }) => {
      const args = [
        "get",
        "values",
        release,
        "-n",
        namespace ?? "default",
        "-o",
        "json",
      ];
      if (allValues) args.push("--all");
      if (context) args.push("--kube-context", context);

      const result = await execJson<Record<string, unknown>>("helm", args, {
        timeout: TIMEOUT.INFRA,
      });

      if (result.error) {
        return err(result.error, { values: {} });
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
      description:
        "Diagnose a Helm release's health in one call: combines helm status + helm history into " +
        "current status, likely causes, suggested next commands, and recent-revision evidence.",
      inputSchema: {
        release: z.string().describe("Release name"),
        namespace: z
          .string()
          .optional()
          .default("default")
          .describe("Namespace"),
        context: z.string().optional().describe("Kubectl context"),
      },
      outputSchema: {
        status: z.string(),
        healthy: z.boolean(),
        revision: z.number(),
        revisions: z.number(),
        likelyCauses: z.array(z.string()),
        suggestedNextCommands: z.array(z.string()),
        evidence: z.array(z.string()),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ release, namespace, context }) => {
      const ns = namespace ?? "default";
      const ctxArgs = context ? ["--kube-context", context] : [];
      const empty = {
        status: "error",
        healthy: false,
        revision: 0,
        revisions: 0,
        likelyCauses: [],
        suggestedNextCommands: [],
        evidence: [],
      };

      const statusRes = await execJson<HelmStatusInfo>(
        "helm",
        ["status", release, "-n", ns, "-o", "json", ...ctxArgs],
        { timeout: TIMEOUT.INFRA },
      );
      if (statusRes.error || !statusRes.data) {
        return err(statusRes.error ?? "helm status: no data", empty);
      }

      // History is best-effort — a missing history shouldn't fail the triage.
      const histRes = await execJson<HelmHistoryEntry[]>(
        "helm",
        ["history", release, "-n", ns, "-o", "json", ...ctxArgs],
        { timeout: TIMEOUT.INFRA },
      );

      return ok(triageRelease(statusRes.data, histRes.data ?? []));
    },
  );
}

// ── Types ───────────────────────────────────────────────────────────

/** A single Helm release from helm list -o json. */
interface HelmRelease {
  name?: string;
  namespace?: string;
  revision?: string;
  status?: string;
  chart?: string;
  app_version?: string;
  updated?: string;
}

/** Detailed Helm release status from helm status -o json. */
interface HelmStatus {
  name?: string;
  namespace?: string;
  version?: number;
  info?: {
    status?: string;
    description?: string;
    last_deployed?: string;
    notes?: string;
  };
}
