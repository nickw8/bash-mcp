/**
 * bash-mcp — MCP Server Entry Point
 *
 * Creates the MCP server, registers all tool groups, and connects
 * via stdio transport. Each tool group is a separate module under
 * src/tools/ that exports a single register function.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerArgocdTools } from "./tools/argocd/argocd.js";
import { registerBatchTools } from "./tools/batch/batch.js";
import { registerDotnetTools } from "./tools/dotnet/dotnet.js";
import { registerFileTools } from "./tools/file/file.js";
import { registerFilesystemTools } from "./tools/filesystem/filesystem.js";
import { registerGitDiffContentTools } from "./tools/git/diff.js";
import { registerGitTools } from "./tools/git/git.js";
import { registerHelmTools } from "./tools/helm/helm.js";
import { registerJsonTools } from "./tools/json/json.js";
import { registerKubernetesTools } from "./tools/kubernetes/kubernetes.js";
import { registerNpmTools } from "./tools/npm/npm.js";
import { registerRunTools } from "./tools/run/run.js";
import { registerSearchTools } from "./tools/search/search.js";
import { registerTerraformTools } from "./tools/terraform/terraform.js";
import { registerYamlTools } from "./tools/yaml/yaml.js";

const server = new McpServer({
  name: "bash-mcp",
  version: "0.1.0",
});

// ── Register all tool groups ──────────────────────────────────────────
registerFilesystemTools(server);
registerSearchTools(server);
registerGitTools(server);
registerKubernetesTools(server);
registerTerraformTools(server);
registerArgocdTools(server);
registerHelmTools(server);
registerJsonTools(server);
registerYamlTools(server);
registerFileTools(server);
registerRunTools(server);
registerBatchTools(server);
registerGitDiffContentTools(server);
registerNpmTools(server);
registerDotnetTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bash-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
