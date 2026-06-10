import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBashLintTool } from "./lint.js";
import { registerBashSyntaxCheckTool } from "./syntax-check.js";
import { registerBashTestTool } from "./test.js";

export function registerShellTools(server: McpServer) {
  registerBashSyntaxCheckTool(server);
  registerBashLintTool(server);
  registerBashTestTool(server);
}
