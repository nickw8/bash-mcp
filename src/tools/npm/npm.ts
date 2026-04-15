/**
 * NPM Tools
 *
 * Structured wrappers for common Node.js dev tools (biome, vitest, tsc).
 * Each tool uses the underlying tool's JSON reporter or parseable output
 * to return structured diagnostics/results instead of verbose text.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerNpmLintTool } from "./lint.js";
import { registerNpmTestTool } from "./test.js";
import { registerNpmTypecheckTool } from "./typecheck.js";

/** Register all npm tools on the MCP server. */
export function registerNpmTools(server: McpServer) {
  registerNpmLintTool(server);
  registerNpmTestTool(server);
  registerNpmTypecheckTool(server);
}
