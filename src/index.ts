/**
 * bash-mcp — MCP Server Entry Point
 *
 * Creates the MCP server, registers all tool groups, and connects
 * via stdio transport. Each tool group is a separate module under
 * src/tools/ that exports a single register function.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { formatReport, runDoctor } from "./doctor.js";
import { logLifecycle } from "./logger.js";
import { registerAll } from "./registry.js";
import { VERSION } from "./version.js";

const server = new McpServer(
  {
    name: "bash-mcp",
    version: VERSION,
  },
  {
    instructions: [
      "Structured CLI wrappers that return JSON instead of raw text.",
      "Philosophy: reach for a structured tool first; `run`/`batch` are the escape hatch",
      "for commands without a dedicated wrapper. Prefer a diagnostic tool (one call that",
      "returns status + likely causes + suggested next commands + evidence) over chaining",
      "raw commands and reasoning across their output yourself.",
      "Use for: capability discovery (check_environment), tool-selection guidance",
      "(list_guidance — an intent→preferred-tool index), reading files (cat, outline),",
      "filesystem listing (ls, tree, du, find_files),",
      "file search (rg/ripgrep, glob), git operations (status, log, diff, branches,",
      "diff_content, repo_health_summary, git_pr_context),",
      "running shell commands (run), parallel tool execution (batch),",
      "JSON/YAML processing (jq, yq), npm tasks (test, lint, typecheck),",
      "dotnet builds (build, test), Python tasks (lint, test, typecheck),",
      "shell scripts (bash_syntax_check, bash_lint via shellcheck, bash_test via bats),",
      "Liquibase (validate, update_sql, status),",
      "and infrastructure: Kubernetes (kube_get, kube_logs, kube_contexts, plus diagnostics",
      "kube_diagnose_pod, kube_pod_failure_summary, kube_deployment_status,",
      "kube_events_summary),",
      "Terraform/OpenTofu (state list, show, plan summary, workspaces, outputs, providers,",
      "validate, modules, backend; `binary:'tofu'` or $TF_BINARY selects OpenTofu),",
      "Helm (list, status, values, release_triage), ArgoCD (apps, app detail, app diff,",
      "app_health_summary).",
      "Prefer these over raw Bash for structured output and lower token usage.",
      "Caveat: reading a file with cat does NOT satisfy the built-in Edit/Write",
      '"must read first" guard (it tracks only the built-in Read tool) — use the',
      "built-in Read on a file immediately before editing it.",
      "Config: BASH_MCP_LOG (error|info|off) controls wide-event logging to stderr;",
      "BASH_MCP_MODE (readOnly|confirmWrites|off, default readOnly) gates run/batch.",
    ].join(" "),
  },
);

// ── Register all tool groups (shared list lives in src/registry.ts) ────
registerAll(server);

async function main() {
  // `--doctor`: run preflight checks, print a report, and exit before starting
  // the server. Safe to use stdout here — there is no MCP session yet.
  if (process.argv.slice(2).includes("--doctor")) {
    const { checks, exitCode } = await runDoctor();
    console.log(formatReport(checks));
    process.exit(exitCode);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logLifecycle({ event: "server_start", transport: "stdio" });
}

main().catch((error) => {
  logLifecycle({
    event: "server_error",
    error:
      error instanceof Error
        ? { message: error.message, type: error.name }
        : String(error),
  });
  process.exit(1);
});
