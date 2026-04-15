/**
 * Filesystem Tools
 *
 * Wraps standard filesystem commands (ls, tree, du, find) and returns
 * structured JSON instead of human-readable text. Each tool is in its
 * own module; this barrel registers them all on the MCP server.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDuTool } from "./du.js";
import { registerFindTool } from "./find.js";
import { registerLsTool } from "./ls.js";
import { registerTreeTool } from "./tree.js";

/** Register all filesystem tools on the MCP server. */
export function registerFilesystemTools(server: McpServer) {
  registerLsTool(server);
  registerTreeTool(server);
  registerDuTool(server);
  registerFindTool(server);
}
