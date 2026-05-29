import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPythonLintTool } from "./lint.js";
import { registerPythonTestTool } from "./test.js";
import { registerPythonTypecheckTool } from "./typecheck.js";

export function registerPythonTools(server: McpServer) {
  registerPythonLintTool(server);
  registerPythonTestTool(server);
  registerPythonTypecheckTool(server);
}
