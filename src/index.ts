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
import { registerEnvTools } from "./tools/env/env.js";
import { registerFileTools } from "./tools/file/file.js";
import { registerFilesystemTools } from "./tools/filesystem/filesystem.js";
import { registerGitDiffContentTools } from "./tools/git/diff.js";
import { registerGitTools } from "./tools/git/git.js";
import { registerHelmTools } from "./tools/helm/helm.js";
import { registerJsonTools } from "./tools/json/json.js";
import { registerKubernetesTools } from "./tools/kubernetes/kubernetes.js";
import { registerNpmTools } from "./tools/npm/npm.js";
import { registerPythonTools } from "./tools/python/python.js";
import { registerRunTools } from "./tools/run/run.js";
import { registerSearchTools } from "./tools/search/search.js";
import { registerTerraformTools } from "./tools/terraform/terraform.js";
import { registerYamlTools } from "./tools/yaml/yaml.js";

const server = new McpServer(
  {
    name: "bash-mcp",
    version: "0.1.0",
  },
  {
    instructions: [
      "Structured CLI wrappers that return JSON instead of raw text.",
      "Use for: reading files (cat, outline), filesystem listing (ls, tree, du, find_files),",
      "file search (rg/ripgrep, glob), git operations (status, log, diff, branches, diff_content),",
      "running shell commands (run), parallel tool execution (batch),",
      "JSON/YAML processing (jq, yq), npm tasks (test, lint, typecheck),",
      "dotnet builds (build, test), Python tasks (lint, test, typecheck),",
      "and infrastructure: Kubernetes (kubectl get, logs, contexts),",
      "Terraform (state list, show, plan summary, workspaces),",
      "Helm (list releases, status, values), ArgoCD (apps, app detail, app diff).",
      "Prefer these over raw Bash for structured output and lower token usage.",
    ].join(" "),
  },
);

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
registerPythonTools(server);
registerEnvTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bash-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
