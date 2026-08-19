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
import { formatInstallReport, installClaudeAssets } from "./install-claude.js";
import { logLifecycle, resolveLevel } from "./logger.js";
import { registerAll } from "./registry.js";
import { VERSION } from "./version.js";

const server = new McpServer(
  {
    name: "bash-mcp",
    version: VERSION,
  },
  {
    // Deliberately does NOT enumerate the tools: the same handshake sends
    // tools/list with every name and description, and `list_guidance` is the
    // intent→preferred-tool index. A prose copy here would be a second
    // inventory nothing generates and nothing checks.
    instructions: [
      "Structured CLI wrappers that return JSON instead of raw text.",
      "Philosophy: reach for a structured tool first; `run`/`batch` are the escape hatch",
      "for commands without a dedicated wrapper. Prefer a diagnostic tool (one call that",
      "returns status + likely causes + suggested next commands + evidence) over chaining",
      "raw commands and reasoning across their output yourself.",
      "Prefer these over raw Bash for structured output and lower token usage;",
      "call check_environment for which CLIs are installed, and list_guidance for the",
      "intent→preferred-tool index.",
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

/**
 * Log one lifecycle event and exit non-zero.
 *
 * A stdio server that dies without this leaves the client holding a closed pipe
 * and no reason for it — the transport reports a parse/connection failure, and
 * the actual error is gone. Exiting non-zero is what tells the client to restart
 * rather than wait.
 */
function fatal(event: string, error: unknown): never {
  logLifecycle({
    event,
    error:
      error instanceof Error
        ? { message: error.message, type: error.name }
        : String(error),
  });
  process.exit(1);
}

process.on("uncaughtException", (error) => fatal("uncaught_exception", error));
process.on("unhandledRejection", (reason) =>
  fatal("unhandled_rejection", reason),
);

async function main() {
  const args = process.argv.slice(2);

  // `--doctor`: run preflight checks, print a report, and exit before starting
  // the server. Safe to use stdout here — there is no MCP session yet.
  if (args.includes("--doctor")) {
    const { checks, exitCode } = await runDoctor();
    console.log(formatReport(checks));
    process.exit(exitCode);
  }

  // `--install-claude [--check]`: copy the rules file + redirect hook into
  // ~/.claude (or report drift) and exit. Lets npm-installed consumers wire up
  // the agent assets without cloning the repo.
  if (args.includes("--install-claude")) {
    const result = installClaudeAssets({ check: args.includes("--check") });
    console.log(formatInstallReport(result));
    process.exit(result.exitCode);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // A clean boot says nothing. Some clients read anything on stderr during the
  // handshake as a failed start, and "the server started" is not news — the
  // handshake itself proves it. Gated behind BASH_MCP_LOG=info; fatal events
  // still bypass the level (ADR-0004, amended).
  if (resolveLevel(process.env.BASH_MCP_LOG) === "info") {
    logLifecycle({ event: "server_start", transport: "stdio" });
  }
}

main().catch((error) => fatal("server_error", error));
