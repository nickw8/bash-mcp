#!/usr/bin/env node

/**
 * bash-mcp — MCP Server Entry Point
 *
 * Creates the MCP server, registers all tool groups, and connects
 * via stdio transport. Each tool group is a separate module under
 * src/tools/ that exports a single register function.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerFilesystemTools } from "./tools/filesystem/filesystem.js";
import { registerSearchTools } from "./tools/search/search.js";
import { registerGitTools } from "./tools/git/git.js";
import { registerKubernetesTools } from "./tools/kubernetes/kubernetes.js";
import { registerTerraformTools } from "./tools/terraform/terraform.js";
import { registerArgocdTools } from "./tools/argocd/argocd.js";
import { registerHelmTools } from "./tools/helm/helm.js";
import { registerJsonTools } from "./tools/json/json.js";
import { registerYamlTools } from "./tools/yaml/yaml.js";
import { registerFileTools } from "./tools/file/file.js";
import { registerRunTools } from "./tools/run/run.js";
import { registerBatchTools } from "./tools/batch/batch.js";
import { registerGitDiffContentTools } from "./tools/git/diff.js";

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bash-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
