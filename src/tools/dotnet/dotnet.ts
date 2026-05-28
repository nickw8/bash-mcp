/**
 * .NET tool group — structured output for dotnet CLI commands.
 *
 * Registers dotnet_build and dotnet_test tools that parse MSBuild and TRX
 * output into compact, token-efficient structured JSON.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDotnetBuildTool } from "./build.js";
import { registerDotnetTestTool } from "./test.js";

/** Register all .NET tools on the given MCP server. */
export function registerDotnetTools(server: McpServer) {
  registerDotnetBuildTool(server);
  registerDotnetTestTool(server);
}
