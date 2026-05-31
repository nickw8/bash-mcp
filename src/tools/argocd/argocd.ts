/**
 * ArgoCD Tools
 *
 * Wraps the argocd CLI (app list, app get, app diff) and returns
 * structured JSON. Summarizes sync/health status and includes
 * per-resource health for detailed application inspection.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, execJson, TIMEOUT } from "#exec";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import { type ArgoAppHealth, summarizeAppHealth } from "./health.js";

/** Register all ArgoCD tools on the MCP server. */
export function registerArgocdTools(server: McpServer) {
  // ── argocd app list ─────────────────────────────────────────────────
  defineTool(
    server,
    "argo_apps",
    {
      title: "ArgoCD applications",
      description:
        "List ArgoCD applications with sync/health status. Structured summary instead of table output.",
      inputSchema: {
        project: z.string().optional().describe("Filter by ArgoCD project"),
        selector: z.string().optional().describe("Label selector"),
      },
      outputSchema: {
        apps: z.array(
          z.object({
            name: z.string(),
            project: z.string(),
            syncStatus: z.string(),
            healthStatus: z.string(),
            repo: z.string(),
            path: z.string(),
            targetRevision: z.string(),
            namespace: z.string(),
            cluster: z.string(),
          }),
        ),
        count: z.number(),
        summary: z.object({
          synced: z.number(),
          outOfSync: z.number(),
          healthy: z.number(),
          degraded: z.number(),
        }),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project, selector }) => {
      const args = ["app", "list", "-o", "json"];
      if (project) args.push("-p", project);
      if (selector) args.push("-l", selector);

      const result = await execJson<ArgoApp[]>("argocd", args, {
        timeout: TIMEOUT.INFRA,
      });

      if (result.error) {
        return err(result.error, {
          apps: [],
          count: 0,
          summary: { synced: 0, outOfSync: 0, healthy: 0, degraded: 0 },
        });
      }

      const rawApps = Array.isArray(result.data) ? result.data : [];
      const apps = rawApps.map((app) => ({
        name: app.metadata?.name ?? "",
        project: app.spec?.project ?? "",
        syncStatus: app.status?.sync?.status ?? "Unknown",
        healthStatus: app.status?.health?.status ?? "Unknown",
        repo: app.spec?.source?.repoURL ?? "",
        path: app.spec?.source?.path ?? "",
        targetRevision: app.spec?.source?.targetRevision ?? "",
        namespace: app.spec?.destination?.namespace ?? "",
        cluster: app.spec?.destination?.server ?? "",
      }));

      const summary = {
        synced: apps.filter((a) => a.syncStatus === "Synced").length,
        outOfSync: apps.filter((a) => a.syncStatus === "OutOfSync").length,
        healthy: apps.filter((a) => a.healthStatus === "Healthy").length,
        degraded: apps.filter((a) => a.healthStatus === "Degraded").length,
      };

      return ok({ apps, count: apps.length, summary });
    },
  );

  // ── argocd app get ──────────────────────────────────────────────────
  defineTool(
    server,
    "argo_app_detail",
    {
      title: "ArgoCD app detail",
      description:
        "Get detailed status for a single ArgoCD application including resource health.",
      inputSchema: {
        name: z.string().describe("Application name"),
      },
      outputSchema: {
        name: z.string(),
        project: z.string(),
        syncStatus: z.string(),
        healthStatus: z.string(),
        revision: z.string(),
        message: z.string(),
        resources: z.array(
          z.object({
            kind: z.string(),
            name: z.string(),
            namespace: z.string(),
            status: z.string(),
            health: z.string(),
          }),
        ),
        conditions: z.array(
          z.object({
            type: z.string(),
            message: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => {
      const result = await execJson<ArgoApp>(
        "argocd",
        ["app", "get", name, "-o", "json"],
        { timeout: TIMEOUT.INFRA },
      );

      if (result.error || !result.data) {
        return err(result.error ?? "argocd app get: no data", {
          name,
          project: "",
          syncStatus: "",
          healthStatus: "",
          revision: "",
          message: "",
          resources: [],
          conditions: [],
        });
      }

      const app = result.data;
      const resources = (app.status?.resources ?? []).map((r) => ({
        kind: r.kind ?? "",
        name: r.name ?? "",
        namespace: r.namespace ?? "",
        status: r.status ?? "",
        health: r.health?.status ?? "Unknown",
      }));

      const conditions = (app.status?.conditions ?? []).map((c) => ({
        type: c.type ?? "",
        message: c.message ?? "",
      }));

      return ok({
        name: app.metadata?.name ?? name,
        project: app.spec?.project ?? "",
        syncStatus: app.status?.sync?.status ?? "",
        healthStatus: app.status?.health?.status ?? "",
        revision: app.status?.sync?.revision ?? "",
        message: app.status?.operationState?.message ?? "",
        resources,
        conditions,
      });
    },
  );

  // ── argocd app diff ─────────────────────────────────────────────────
  defineTool(
    server,
    "argo_app_diff",
    {
      title: "ArgoCD app diff",
      description: "Show what's out of sync for an ArgoCD application.",
      inputSchema: {
        name: z.string().describe("Application name"),
      },
      outputSchema: {
        hasDiff: z.boolean(),
        diff: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => {
      const result = await exec(
        "argocd",
        ["app", "diff", name, "--local-repo-root", "."],
        { timeout: TIMEOUT.INFRA },
      );

      const hasDiff = result.exitCode !== 0;
      const structuredContent = {
        hasDiff,
        diff: result.stdout || result.stderr,
      };
      return {
        content: [
          {
            type: "text" as const,
            text: hasDiff ? structuredContent.diff : "In sync",
          },
        ],
        structuredContent,
      };
    },
  );

  // ── argocd app health summary ───────────────────────────────────────
  defineTool(
    server,
    "argo_app_health_summary",
    {
      title: "ArgoCD app health summary",
      description:
        "Diagnose an ArgoCD application's health in one call: overall sync/health, likely causes, " +
        "suggested next commands, and the unhealthy resources/conditions as evidence.",
      inputSchema: {
        name: z.string().describe("Application name"),
      },
      outputSchema: {
        name: z.string(),
        status: z.string(),
        syncStatus: z.string(),
        healthy: z.boolean(),
        likelyCauses: z.array(z.string()),
        suggestedNextCommands: z.array(z.string()),
        evidence: z.array(z.string()),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => {
      const result = await execJson<ArgoAppHealth>(
        "argocd",
        ["app", "get", name, "-o", "json"],
        { timeout: TIMEOUT.INFRA },
      );
      if (result.error || !result.data) {
        return err(result.error ?? "argocd app get: no data", {
          name,
          status: "Unknown",
          syncStatus: "Unknown",
          healthy: false,
          likelyCauses: [],
          suggestedNextCommands: [],
          evidence: [],
        });
      }
      const summary = summarizeAppHealth(result.data);
      return ok({ ...summary, name: summary.name || name });
    },
  );
}

// ── Types ───────────────────────────────────────────────────────────

/** Partial representation of an ArgoCD application from JSON output. */
interface ArgoApp {
  metadata?: { name?: string };
  spec?: {
    project?: string;
    source?: { repoURL?: string; path?: string; targetRevision?: string };
    destination?: { server?: string; namespace?: string };
  };
  status?: {
    sync?: { status?: string; revision?: string };
    health?: { status?: string };
    operationState?: { message?: string };
    resources?: Array<{
      kind?: string;
      name?: string;
      namespace?: string;
      status?: string;
      health?: { status?: string };
    }>;
    conditions?: Array<{ type?: string; message?: string }>;
  };
}
