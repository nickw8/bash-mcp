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
import { registerGithubTools } from "./tools/github/github.js";
import { registerGitlabTools } from "./tools/gitlab/gitlab.js";
import { registerGuidanceTools } from "./tools/guidance/guidance.js";
import { registerHelmTools } from "./tools/helm/helm.js";
import { registerJsonTools } from "./tools/json/json.js";
import { registerKubernetesTools } from "./tools/kubernetes/kubernetes.js";
import { registerLiquibaseTools } from "./tools/liquibase/liquibase.js";
import { registerNpmTools } from "./tools/npm/npm.js";
import { registerPythonTools } from "./tools/python/python.js";
import { registerResultTools } from "./tools/result/result.js";
import { registerRunTools } from "./tools/run/run.js";
import { registerRunSeqTools } from "./tools/run/seq.js";
import { registerSearchTools } from "./tools/search/search.js";
import { registerShellTools } from "./tools/shell/shell.js";
import { registerTerraformTools } from "./tools/terraform/terraform.js";
import { registerYamlTools } from "./tools/yaml/yaml.js";

export const PROFILES = [
  "core",
  "development",
  "infrastructure",
  "all",
] as const;
export type Profile = (typeof PROFILES)[number];

/**
 * `core` groups load under every profile. The others name the profiles that
 * add them; `all` loads every group.
 */
type GroupProfiles = "core" | readonly ("development" | "infrastructure")[];
const DEV = ["development"] as const;
const INFRA = ["infrastructure"] as const;
const BOTH = ["development", "infrastructure"] as const;

/** A tool group, the README category its tools belong to, and its profiles. */
interface ToolGroup {
  category: string;
  register: (server: McpServer) => void;
  profiles: GroupProfiles;
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
  {
    category: "Filesystem",
    register: registerFilesystemTools,
    profiles: "core",
  },
  { category: "Search", register: registerSearchTools, profiles: "core" },
  { category: "Git", register: registerGitTools, profiles: "core" },
  {
    category: "Kubernetes",
    register: registerKubernetesTools,
    profiles: INFRA,
  },
  { category: "Terraform", register: registerTerraformTools, profiles: INFRA },
  { category: "ArgoCD", register: registerArgocdTools, profiles: INFRA },
  { category: "Helm", register: registerHelmTools, profiles: INFRA },
  { category: "Data Processing", register: registerJsonTools, profiles: BOTH },
  { category: "Data Processing", register: registerYamlTools, profiles: BOTH },
  { category: "File", register: registerFileTools, profiles: "core" },
  { category: "Execution", register: registerRunTools, profiles: "core" },
  { category: "Execution", register: registerRunSeqTools, profiles: "core" },
  { category: "Execution", register: registerBatchTools, profiles: "core" },
  { category: "Git", register: registerGitDiffContentTools, profiles: "core" },
  { category: "Node.js", register: registerNpmTools, profiles: DEV },
  { category: ".NET", register: registerDotnetTools, profiles: DEV },
  { category: "Liquibase", register: registerLiquibaseTools, profiles: BOTH },
  { category: "Python", register: registerPythonTools, profiles: DEV },
  { category: "Shell", register: registerShellTools, profiles: DEV },
  { category: "Environment", register: registerEnvTools, profiles: "core" },
  {
    category: "Environment",
    register: registerGuidanceTools,
    profiles: "core",
  },
  { category: "GitHub", register: registerGithubTools, profiles: BOTH },
  { category: "GitLab", register: registerGitlabTools, profiles: BOTH },
  { category: "Results", register: registerResultTools, profiles: "core" },
];

/**
 * Register every tool group on a server, in a stable order. Shared by the live
 * entry point (src/index.ts) and `buildRegistry()` so the tool list has one
 * source of truth.
 */
export function registerAll(
  server: McpServer,
  profile: Profile = profileFromEnv(),
): void {
  for (const group of GROUPS) {
    if (inProfile(group, profile)) group.register(server);
  }
}

function inProfile({ profiles }: ToolGroup, profile: Profile): boolean {
  if (profile === "all" || profiles === "core") return true;
  return profile !== "core" && profiles.includes(profile);
}

/** `BASH_MCP_PROFILE`, or `all`. Throws on an unknown value. */
export function profileFromEnv(raw = process.env.BASH_MCP_PROFILE): Profile {
  if (raw === undefined || raw === "") return "all";
  if ((PROFILES as readonly string[]).includes(raw)) return raw as Profile;
  throw new Error(
    `BASH_MCP_PROFILE=${raw} is not one of ${PROFILES.join(", ")}`,
  );
}

/** Tool names a profile registers, for docs and tests. */
export function toolsInProfile(profile: Profile): string[] {
  const stub = {
    registerTool() {
      return undefined;
    },
  } as unknown as McpServer;
  resetRegistry();
  for (const group of GROUPS) {
    if (inProfile(group, profile)) group.register(stub);
  }
  const names = getRegisteredTools().map((t) => t.name);
  resetRegistry();
  return names;
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
