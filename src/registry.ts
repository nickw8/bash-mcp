/**
 * Tool Registry & Reference Renderer
 *
 * Single source of truth for *which* tool groups are registered (`registerAll`,
 * shared by the live entry point in src/index.ts) and a `buildRegistry()` that
 * runs every group against a no-op server to collect a `ToolRecord[]` for doc
 * generation — no MCP SDK internals are touched.
 *
 * `renderToolDocs` turns that registry into a deterministic markdown reference
 * (docs/tools.md). The generator (scripts/gen-tool-docs.mjs) and the CI guard
 * (src/registry.test.ts) both import from here, mirroring how
 * scripts/benchmark-core.mjs is shared between the benchmark script and its guard.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape, ZodTypeAny } from "zod";
import { getRegisteredTools, resetRegistry, type ToolRecord } from "#tool";
import { registerArgocdTools } from "./tools/argocd/argocd.js";
import { registerBatchTools } from "./tools/batch/batch.js";
import { registerDotnetTools } from "./tools/dotnet/dotnet.js";
import { registerEnvTools } from "./tools/env/env.js";
import { registerFileTools } from "./tools/file/file.js";
import { registerFilesystemTools } from "./tools/filesystem/filesystem.js";
import { registerGitDiffContentTools } from "./tools/git/diff.js";
import { registerGitTools } from "./tools/git/git.js";
import {
  type Intent,
  registerGuidanceTools,
} from "./tools/guidance/guidance.js";
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
 * tagging each tool with its group's README category. Resets first so repeated
 * calls (live server + generator/test in-process) don't accumulate duplicates.
 */
export function buildRegistry(): ToolRecord[] {
  resetRegistry();
  const stub = {
    registerTool() {
      return undefined;
    },
  } as unknown as McpServer;
  const all = getRegisteredTools();
  for (const { category, register } of GROUPS) {
    const before = all.length;
    register(stub);
    for (let i = before; i < all.length; i++) {
      const rec = all[i];
      if (rec) rec.category = category;
    }
  }
  return [...all];
}

// ── Zod → readable schema (minimal custom printer; no extra dependency) ──────

/** Unwrap optional/default/nullable/effects, tracking optionality + description. */
function unwrap(t: ZodTypeAny): {
  inner: ZodTypeAny;
  optional: boolean;
  description?: string;
} {
  // biome-ignore lint/suspicious/noExplicitAny: reading Zod's internal _def.
  let cur = t as any;
  let optional = false;
  let description: string | undefined = cur?._def?.description;
  for (;;) {
    const tn = cur?._def?.typeName;
    if (tn === "ZodOptional" || tn === "ZodDefault") {
      optional = true;
      cur = cur._def.innerType;
    } else if (tn === "ZodNullable" || tn === "ZodEffects") {
      cur = tn === "ZodNullable" ? cur._def.innerType : cur._def.schema;
    } else {
      break;
    }
    description ??= cur?._def?.description;
  }
  return { inner: cur, optional, description };
}

/** Best-effort readable type name for a (already unwrapped) Zod type. */
function typeName(t: ZodTypeAny): string {
  // biome-ignore lint/suspicious/noExplicitAny: reading Zod's internal _def.
  const cur = t as any;
  switch (cur?._def?.typeName) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodArray":
      return `${typeName(cur._def.type)}[]`;
    case "ZodEnum":
      return cur._def.values.map((v: string) => JSON.stringify(v)).join(" | ");
    case "ZodLiteral":
      return JSON.stringify(cur._def.value);
    case "ZodObject":
    case "ZodRecord":
      return "object";
    case "ZodUnion":
      return cur._def.options.map((o: ZodTypeAny) => typeName(o)).join(" | ");
    default:
      return "unknown";
  }
}

interface FieldDoc {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
}

/** Flatten a ZodRawShape into per-field docs (insertion order is deterministic). */
function fields(shape?: ZodRawShape): FieldDoc[] {
  if (!shape) return [];
  return Object.entries(shape).map(([name, schema]) => {
    const { inner, optional, description } = unwrap(schema);
    return { name, type: typeName(inner), optional, description };
  });
}

function renderFields(shape: ZodRawShape | undefined, empty: string): string {
  const fs = fields(shape);
  if (fs.length === 0) return `_${empty}_`;
  return fs
    .map((f) => {
      const opt = f.optional ? " _(optional)_" : "";
      const desc = f.description ? ` — ${f.description}` : "";
      return `- \`${f.name}\`: ${f.type}${opt}${desc}`;
    })
    .join("\n");
}

function renderTool(t: ToolRecord): string {
  const parts: string[] = [`## \`${t.name}\``];
  if (t.readOnlyHint) parts.push("`read-only`");
  if (t.description) parts.push(t.description.trim());
  parts.push(`**Inputs:**\n\n${renderFields(t.inputSchema, "no inputs")}`);
  parts.push(
    `**Outputs:**\n\n${renderFields(t.outputSchema, "no structured output")}`,
  );
  if (t.equivalentCommands?.length) {
    parts.push(
      `**Equivalent commands:**\n\n\`\`\`sh\n${t.equivalentCommands.join("\n")}\n\`\`\``,
    );
  }
  return parts.join("\n\n");
}

/**
 * Render the full tool reference as deterministic markdown. Tools are sorted by
 * name with a plain comparison (names are ascii) so output is machine-stable —
 * re-running the generator produces no diff.
 */
export function renderToolDocs(tools: ToolRecord[]): string {
  const sorted = [...tools].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const header = [
    "# Tool Reference",
    "",
    "<!-- GENERATED FILE — do not edit by hand. Regenerate with `npm run docs:tools`. -->",
    "",
    `${sorted.length} tools. Each entry lists inputs, outputs, and (where known) the raw command(s) it approximates.`,
    "",
    "",
  ].join("\n");
  return `${header}${sorted.map(renderTool).join("\n\n")}\n`;
}

// ── README generation (grouped tool tables + "Which tool?" intent table) ─────
//
// These render the two regions of README.md that used to be hand-maintained.
// `renderReadme` is an *idempotent* transform: it replaces the marked regions in
// the current README with freshly rendered content and returns the whole file,
// so the generator (scripts/gen-tool-docs.mjs) and the drift guard
// (src/registry.test.ts) share one source of truth — exactly like docs/tools.md.

const WHICH_TOOL_BEGIN = "<!-- BEGIN GENERATED: which-tool -->";
const WHICH_TOOL_END = "<!-- END GENERATED: which-tool -->";
const TOOLS_BEGIN = "<!-- BEGIN GENERATED: tools -->";
const TOOLS_END = "<!-- END GENERATED: tools -->";

/** Order README categories explicitly (groups not listed fall to the end, sorted). */
const CATEGORY_ORDER = [
  "Environment",
  "Filesystem",
  "Search",
  "File",
  "Git",
  "Kubernetes",
  "Terraform",
  "Helm",
  "ArgoCD",
  "Data Processing",
  ".NET",
  "Liquibase",
  "Node.js",
  "Python",
  "Shell",
  "Execution",
];

/** Escape table-breaking characters and collapse whitespace for a markdown cell. */
function cell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

/** First sentence of a description (terse blurb for the README table). */
function firstSentence(description: string): string {
  const trimmed = description.trim();
  const idx = trimmed.indexOf(". ");
  return idx === -1 ? trimmed : trimmed.slice(0, idx + 1);
}

/**
 * Render the grouped "## Tools" body: one `### Category` table per category, in
 * `CATEGORY_ORDER`, tools in registration order within each. Descriptions are the
 * first sentence of each tool's MCP description (full text lives in docs/tools.md).
 */
export function renderToolsSection(tools: ToolRecord[]): string {
  const byCategory = new Map<string, ToolRecord[]>();
  for (const t of tools) {
    const cat = t.category ?? "Other";
    const list = byCategory.get(cat) ?? [];
    list.push(t);
    byCategory.set(cat, list);
  }
  const categories = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()]
      .filter((c) => !CATEGORY_ORDER.includes(c))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  ];
  return categories
    .map((category) => {
      const rows = (byCategory.get(category) ?? [])
        .map(
          (t) =>
            `| \`${t.name}\` | ${cell(firstSentence(t.description ?? ""))} |`,
        )
        .join("\n");
      return `### ${category}\n\n| Tool | Description |\n|------|-------------|\n${rows}`;
    })
    .join("\n\n");
}

/** Strip the `run: ` prefix from an INTENTS `avoid` entry for display. */
function avoidLabel(raw: string): string {
  return raw.startsWith("run: ") ? raw.slice("run: ".length) : raw;
}

/**
 * Render the "Which tool should I use?" table from the guidance `INTENTS`,
 * mapping intent → preferred tool, with the raw-command anti-patterns to avoid.
 */
export function renderWhichToolTable(intents: readonly Intent[]): string {
  const rows = intents
    .map((i) => {
      const avoid = i.avoid.map((a) => `\`${cell(avoidLabel(a))}\``).join(", ");
      return `| ${cell(i.intent)} | \`${i.preferredTool}\` | ${avoid} |`;
    })
    .join("\n");
  return `| I want to… | Use this | Instead of |\n|------------|----------|------------|\n${rows}`;
}

function replaceRegion(
  source: string,
  begin: string,
  end: string,
  body: string,
): string {
  const b = source.indexOf(begin);
  const e = source.indexOf(end);
  if (b === -1 || e === -1 || e < b) {
    throw new Error(`README is missing the ${begin} … ${end} markers.`);
  }
  return `${source.slice(0, b + begin.length)}\n\n${body}\n\n${source.slice(e)}`;
}

/**
 * Idempotent transform: rewrite README.md's generated regions from the registry
 * and the guidance intents, returning the full file. Re-running produces no diff.
 */
export function renderReadme(
  readme: string,
  tools: ToolRecord[],
  intents: readonly Intent[],
): string {
  let out = replaceRegion(
    readme,
    WHICH_TOOL_BEGIN,
    WHICH_TOOL_END,
    renderWhichToolTable(intents),
  );
  out = replaceRegion(out, TOOLS_BEGIN, TOOLS_END, renderToolsSection(tools));
  return out;
}

// ── Agent rules file generation (claude/rules/bash-mcp-tools.md) ─────────────
//
// The rules file is auto-loaded by Claude Code into every session's context, so
// it is the surface that tells an agent which bash-mcp tools exist before it ever
// reaches for raw Bash. It is generated from the registry (one row per category,
// tools in registration order) so a newly added tool — or a whole new category —
// can never silently go un-advertised the way the liquibase wrapper once did.
//
// The "Instead of" column is the one piece of curated knowledge not derivable
// from the registry (it names Claude Code built-ins like `Read`/`Grep`/`Glob`).
// `CATEGORY_AVOID` holds it, and `renderAgentRules` THROWS if a registry category
// lacks an entry — so adding a category forces a matching avoidance note.

/** Per-category "Instead of" cell: the built-in / raw commands to avoid. */
const CATEGORY_AVOID: Record<string, string> = {
  Environment: "guessing which CLIs exist",
  Filesystem: "`Bash(ls/tree/du/find)`, `Glob`",
  Search: "`Grep`, `Bash(grep)`",
  File: "`Read` (Read only immediately before Edit)",
  Git: "`Bash(git)`",
  Kubernetes: "`Bash(kubectl)`",
  Terraform: "`Bash(terraform/tofu)`",
  Helm: "`Bash(helm)`",
  ArgoCD: "`Bash(argocd)`",
  "Data Processing": "`Read` + manual parsing",
  ".NET": "`Bash(dotnet)`",
  Liquibase: "`Bash(liquibase)`",
  "Node.js": "`Bash(npm)`",
  Python: "`Bash(ruff/pytest/mypy)`",
  Shell: "`Bash(shellcheck/bats/bash -n)`",
  Execution: "`Bash(cd && cmd)`, sequential one-off calls",
};

/** A tool is a "diagnostic" tool if its output carries the triage shape. */
function isDiagnostic(t: ToolRecord): boolean {
  return !!t.outputSchema && "likelyCauses" in t.outputSchema;
}

/**
 * Render the agent-facing rules markdown from the registry. Categories appear in
 * `CATEGORY_ORDER`; tools within each keep registration order. The diagnostic
 * callout is derived from the registry (tools whose output has `likelyCauses`).
 *
 * Throws if a registry category has no `CATEGORY_AVOID` entry, so a new tool
 * group can't ship without a corresponding "use this, not that" row.
 */
export function renderAgentRules(tools: ToolRecord[]): string {
  const byCategory = new Map<string, ToolRecord[]>();
  for (const t of tools) {
    const cat = t.category ?? "Other";
    const list = byCategory.get(cat) ?? [];
    list.push(t);
    byCategory.set(cat, list);
  }
  const categories = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()]
      .filter((c) => !CATEGORY_ORDER.includes(c))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  ];

  const rows = categories.map((category) => {
    const avoid = CATEGORY_AVOID[category];
    if (avoid === undefined) {
      throw new Error(
        `renderAgentRules: category "${category}" has no CATEGORY_AVOID entry. ` +
          `Add one in src/registry.ts so the rules file advertises it.`,
      );
    }
    const use = (byCategory.get(category) ?? [])
      .map((t) => `\`${t.name}\``)
      .join(", ");
    return `| ${category} | ${use} | ${avoid} |`;
  });

  const diagnostics = tools.filter(isDiagnostic).map((t) => `\`${t.name}\``);

  return [
    "# bash-mcp Tools",
    "",
    "<!-- GENERATED FILE — do not edit by hand. Regenerate with `npm run docs:tools`. -->",
    "",
    "Prefer these bash-mcp MCP tools over raw shell / built-ins: structured JSON, fewer tokens.",
    "",
    "| Category | Use bash-mcp | Instead of |",
    "|----------|--------------|------------|",
    ...rows,
    "",
    `**Diagnostic tools** collapse multi-call triage into one answer (status + likely causes + suggested next commands + evidence): ${diagnostics.join(", ")}.`,
    "",
    '`Edit` and `Write` stay built-in. `cat` does NOT satisfy the Edit/Write "read first" guard — run the built-in `Read` immediately before editing.',
    "",
  ].join("\n");
}
