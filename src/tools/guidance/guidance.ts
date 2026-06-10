/**
 * Tool Selection Guidance
 *
 * `list_guidance` returns a machine-readable intent → preferred-tool index so an
 * agent can self-select the right bash-mcp tool for a goal, instead of relying on
 * the PreToolUse redirect hook or the prose in the server `instructions`. It is
 * the advisory, model-facing companion to `check_environment` (which reports
 * *which CLIs exist* rather than *which tool to prefer*).
 *
 * Pattern: one canonical const dispatch table (`/arch:node` const table, same
 * idiom as env.ts `PROBES`). These entries are the single source for both
 * `list_guidance` and the README "Which tool should I use?" table, which the
 * docs:tools generator renders via `renderWhichToolTable` (src/registry.ts) — no
 * hand-syncing.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok } from "#response";
import { defineTool } from "#tool";

/** One intent → preferred-tool recommendation. */
export interface Intent {
  /** Plain-language goal the caller is trying to accomplish. */
  readonly intent: string;
  /** The bash-mcp tool to prefer for this intent. */
  readonly preferredTool: string;
  /** Coarse grouping for filtering, e.g. "kubernetes", "git". */
  readonly category: string;
  /** Raw-command anti-patterns to avoid in favor of `preferredTool`. */
  readonly avoid: readonly string[];
  /** Why the preferred tool wins (one sentence). */
  readonly reason: string;
}

/**
 * The canonical intent table. Curated, not exhaustive — quality over coverage.
 * The README "Which tool should I use?" table is generated from these entries
 * (`renderWhichToolTable` in src/registry.ts); editing here updates both.
 */
export const INTENTS = [
  {
    intent: "diagnose a crashing or failing Kubernetes pod",
    preferredTool: "kube_diagnose_pod",
    category: "kubernetes",
    avoid: ["run: kubectl describe pod", "run: kubectl logs"],
    reason:
      "One call returns status, events, likely causes, and suggested next commands.",
  },
  {
    intent: "find all not-ready or failing pods in a namespace",
    preferredTool: "kube_pod_failure_summary",
    category: "kubernetes",
    avoid: ["run: kubectl get pods", "run: kubectl get pods | grep"],
    reason:
      "Aggregates failing pods with reasons instead of raw table scraping.",
  },
  {
    intent: "check a deployment's rollout health",
    preferredTool: "kube_deployment_status",
    category: "kubernetes",
    avoid: ["run: kubectl rollout status", "run: kubectl get deployment"],
    reason:
      "Reports replica readiness and rollout state in one structured call.",
  },
  {
    intent: "understand recent cluster events",
    preferredTool: "kube_events_summary",
    category: "kubernetes",
    avoid: ["run: kubectl get events"],
    reason: "Groups and ranks events instead of dumping the raw event stream.",
  },
  {
    intent: "summarize the changes in a Terraform plan",
    preferredTool: "tf_plan_summary",
    category: "terraform",
    avoid: ["run: terraform plan", "run: terraform show"],
    reason: "Returns add/change/destroy counts without the full plan text.",
  },
  {
    intent: "review the current feature branch before a PR",
    preferredTool: "git_pr_context",
    category: "git",
    avoid: ["run: git diff", "run: git log", "run: git status"],
    reason: "Bundles branch diff, commits, and status into one PR-shaped view.",
  },
  {
    intent: "understand the overall state of a repository",
    preferredTool: "repo_health_summary",
    category: "git",
    avoid: ["run: git status", "run: git log --oneline"],
    reason:
      "One call returns status, ahead/behind, and recent-activity signals.",
  },
  {
    intent: "read a file's structure without loading the full body",
    preferredTool: "outline",
    category: "file",
    avoid: ["cat (entire file)", "run: cat"],
    reason: "Returns symbols/headings so you can target what to read next.",
  },
  {
    intent: "search for exact code references or symbols",
    preferredTool: "rg",
    category: "search",
    avoid: ["run: grep -r", "run: rg"],
    reason:
      "Structured matches with file/line, far less token noise than raw grep.",
  },
  {
    intent: "triage why a Helm release is unhealthy",
    preferredTool: "helm_release_triage",
    category: "helm",
    avoid: ["run: helm status", "run: helm get values"],
    reason: "Combines status, values, and likely causes into one diagnosis.",
  },
  {
    intent: "check whether an ArgoCD app is healthy and in sync",
    preferredTool: "argo_app_health_summary",
    category: "argocd",
    avoid: ["run: argocd app get", "run: argocd app list"],
    reason: "Summarizes health/sync with degraded resources surfaced.",
  },
  {
    intent: "validate a Liquibase changelog for errors",
    preferredTool: "liquibase_validate",
    category: "liquibase",
    avoid: ["run: liquibase validate"],
    reason:
      "Returns a structured pass/fail with per-changeset errors instead of raw text.",
  },
  {
    intent: "preview the SQL Liquibase would run for pending changesets",
    preferredTool: "liquibase_update_sql",
    category: "liquibase",
    avoid: ["run: liquibase updateSQL", "run: liquibase updateSQL | grep"],
    reason:
      "Per-changeset summaries with a SQL-Server batch lint, without applying changes.",
  },
  {
    intent: "list Liquibase changesets not yet applied to the database",
    preferredTool: "liquibase_status",
    category: "liquibase",
    avoid: ["run: liquibase status --verbose"],
    reason: "Reports up-to-date vs a structured pending list, not raw output.",
  },
  {
    intent: "discover which CLIs are installed before calling a tool",
    preferredTool: "check_environment",
    category: "environment",
    avoid: ["run: which", "run: <tool> --version"],
    reason:
      "Probes the whole toolchain in parallel, client-only and non-blocking.",
  },
] as const satisfies readonly Intent[];

/** Register the guidance tools on the MCP server. */
export function registerGuidanceTools(server: McpServer) {
  defineTool(
    server,
    "list_guidance",
    {
      title: "List tool-selection guidance",
      description:
        "Return an intent → preferred-tool index so you can pick the right bash-mcp tool for a goal. " +
        "Each entry names the tool to prefer, raw-command anti-patterns to avoid, and why. " +
        "Filter with `intent` (substring) or `category` to narrow the list.",
      inputSchema: {
        intent: z
          .string()
          .optional()
          .describe("Case-insensitive substring filter on the intent text."),
        category: z
          .string()
          .optional()
          .describe(
            "Exact category filter, e.g. 'kubernetes', 'git', 'terraform'.",
          ),
      },
      outputSchema: {
        intents: z.array(
          z.object({
            intent: z.string(),
            preferredTool: z.string(),
            category: z.string(),
            avoid: z.array(z.string()),
            reason: z.string(),
          }),
        ),
        total: z.number(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ intent, category }) => {
      const needle = intent?.toLowerCase();
      const intents = INTENTS.filter((entry) => {
        if (category && entry.category !== category) return false;
        if (needle && !entry.intent.toLowerCase().includes(needle))
          return false;
        return true;
      });
      return ok({ intents, total: intents.length });
    },
  );
}
