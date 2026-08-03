/**
 * Tool Registry
 *
 * Single source of truth for *which* tool groups are registered (`registerAll`,
 * shared by the live entry point in src/index.ts) and a `buildRegistry()` that
 * runs every group against a no-op server to collect a `ToolRecord[]` for doc
 * generation — no MCP SDK internals are touched.
 *
 * What the registry is, not how it is published: the renderers that turn a
 * `ToolRecord[]` into docs/tools.md, the README regions, and the agent rules
 * file live in src/docs/render.ts, which the generator and its guard import.
 * This module stays on the server's boot path (ADR-0002).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRegisteredTools, resetRegistry, type ToolRecord } from "#tool";
import { registerArgocdTools } from "./tools/argocd/argocd.js";
import { registerBatchTools } from "./tools/batch/batch.js";
import { registerDotnetTools } from "./tools/dotnet/dotnet.js";
import { registerEnvTools } from "./tools/env/env.js";
import { registerFileTools } from "./tools/file/file.js";
import { registerFilesystemTools } from "./tools/filesystem/filesystem.js";
import { registerGitDiffContentTools } from "./tools/git/diff.js";
import { registerGitTools } from "./tools/git/git.js";
import { registerGuidanceTools } from "./tools/guidance/guidance.js";
import { registerHelmTools } from "./tools/helm/helm.js";
import { registerJsonTools } from "./tools/json/json.js";
import { registerKubernetesTools } from "./tools/kubernetes/kubernetes.js";
import { registerLiquibaseTools } from "./tools/liquibase/liquibase.js";
import { registerNpmTools } from "./tools/npm/npm.js";
import { registerPythonTools } from "./tools/python/python.js";
import { registerRunTools } from "./tools/run/run.js";
import { registerRunSeqTools } from "./tools/run/seq.js";
import { registerSearchTools } from "./tools/search/search.js";
import { registerShellTools } from "./tools/shell/shell.js";
import { registerTerraformTools } from "./tools/terraform/terraform.js";
import { registerYamlTools } from "./tools/yaml/yaml.js";

/** A tool group plus the README category its tools belong to. */
interface ToolGroup {
  category: string;
  register: (server: McpServer) => void;
}

/**
 * Single source of truth for *which* tool groups exist, in registration order,
 * and the README category each contributes to. Shared by the live entry point
 * (`registerAll`, used by src/index.ts) and `buildRegistry()`, so the tool list
 * and its categorisation never drift between the server and the generated docs.
 *
 * Multiple groups may share a category (e.g. git.ts + diff.ts → "Git",
 * json.ts + yaml.ts → "Data Processing"); they merge into one README section.
 */
const GROUPS: readonly ToolGroup[] = [
  { category: "Filesystem", register: registerFilesystemTools },
  { category: "Search", register: registerSearchTools },
  { category: "Git", register: registerGitTools },
  { category: "Kubernetes", register: registerKubernetesTools },
  { category: "Terraform", register: registerTerraformTools },
  { category: "ArgoCD", register: registerArgocdTools },
  { category: "Helm", register: registerHelmTools },
  { category: "Data Processing", register: registerJsonTools },
  { category: "Data Processing", register: registerYamlTools },
  { category: "File", register: registerFileTools },
  { category: "Execution", register: registerRunTools },
  { category: "Execution", register: registerRunSeqTools },
  { category: "Execution", register: registerBatchTools },
  { category: "Git", register: registerGitDiffContentTools },
  { category: "Node.js", register: registerNpmTools },
  { category: ".NET", register: registerDotnetTools },
  { category: "Liquibase", register: registerLiquibaseTools },
  { category: "Python", register: registerPythonTools },
  { category: "Shell", register: registerShellTools },
  { category: "Environment", register: registerEnvTools },
  { category: "Environment", register: registerGuidanceTools },
];

/**
 * Register every tool group on a server, in a stable order. Shared by the live
 * entry point (src/index.ts) and `buildRegistry()` so the tool list has one
 * source of truth.
 */
export function registerAll(server: McpServer): void {
  for (const { register } of GROUPS) register(server);
}

/**
 * Build the tool registry by registering all groups against a no-op stub server,
 * tagging each tool with its group's README category. One group at a time, with
 * a reset between: whatever a group registered is what gets its category, so the
 * tagging doesn't depend on index arithmetic over a growing shared array.
 */
export function buildRegistry(): ToolRecord[] {
  const stub = {
    registerTool() {
      return undefined;
    },
  } as unknown as McpServer;
  const all: ToolRecord[] = [];
  for (const { category, register } of GROUPS) {
    resetRegistry();
    register(stub);
    for (const rec of getRegisteredTools()) rec.category = category;
    all.push(...getRegisteredTools());
  }
  return all;
}
