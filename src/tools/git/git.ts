/**
 * Git Tools
 *
 * Wraps git commands (status, log, diff, branch) and returns structured
 * JSON. Each tool is in its own module; this barrel registers them all
 * on the MCP server.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGitBranchesTool } from "./branches.js";
import { registerGitDiffSummaryTool } from "./diff-summary.js";
import { registerGitLogTool } from "./log.js";
import { registerGitStatusTool } from "./status.js";

/** Register all git tools on the MCP server. */
export function registerGitTools(server: McpServer) {
  registerGitStatusTool(server);
  registerGitLogTool(server);
  registerGitDiffSummaryTool(server);
  registerGitBranchesTool(server);
}
