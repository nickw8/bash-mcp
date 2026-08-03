/**
 * Doc Renderers
 *
 * Turns the tool registry into every published list: docs/tools.md, the two
 * generated regions of README.md, and the agent-facing rules file. Pure
 * functions — they take `ToolRecord[]` (and the guidance `INTENTS`) and return
 * strings, so the generator (scripts/gen-tool-docs.mjs) and the drift guard
 * (src/docs/render.test.ts) render from one source (ADR-0002).
 *
 * Off the server's boot path: src/index.ts imports `registerAll` from
 * src/registry.ts and never reaches this module.
 */

import type { ZodRawShape, ZodTypeAny } from "zod";
import type { ToolRecord } from "#tool";
import type { Intent } from "../tools/guidance/guidance.js";

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
// (src/docs/render.test.ts) share one source of truth — exactly like docs/tools.md.

const WHICH_TOOL_BEGIN = "<!-- BEGIN GENERATED: which-tool -->";
const WHICH_TOOL_END = "<!-- END GENERATED: which-tool -->";
const TOOLS_BEGIN = "<!-- BEGIN GENERATED: tools -->";
const TOOLS_END = "<!-- END GENERATED: tools -->";

/**
 * The one curated per-category table: array order is the order categories appear
 * in the README and the agent rules file, and the second element is that
 * category's "Instead of" cell (the Claude Code built-ins and raw commands it
 * replaces) — the single piece of knowledge not derivable from the registry.
 *
 * Presentation order deliberately differs from the `GROUPS` registration order
 * in src/registry.ts: that one is boot order, this one is reading order.
 *
 * A registry category missing from here THROWS (`categoryTable`), so a new tool
 * group can't ship un-ordered or un-advertised the way the liquibase wrapper once did.
 */
const CATEGORIES = [
  ["Environment", "guessing which CLIs exist"],
  ["Filesystem", "`Bash(ls/tree/du/find)`, `Glob`"],
  ["Search", "`Grep`, `Bash(grep)`"],
  ["File", "`Read` (Read only immediately before Edit)"],
  ["Git", "`Bash(git)`"],
  ["Kubernetes", "`Bash(kubectl)`"],
  ["Terraform", "`Bash(terraform/tofu)`"],
  ["Helm", "`Bash(helm)`"],
  ["ArgoCD", "`Bash(argocd)`"],
  ["Data Processing", "`Read` + manual parsing"],
  [".NET", "`Bash(dotnet)`"],
  ["Liquibase", "`Bash(liquibase)`"],
  ["Node.js", "`Bash(npm)`"],
  ["Python", "`Bash(ruff/pytest/mypy)`"],
  ["Shell", "`Bash(shellcheck/bats/bash -n)`"],
  ["Execution", "`Bash(cd && cmd)`, sequential one-off calls"],
] as const satisfies readonly (readonly [string, string])[];

const CATEGORY_INDEX = new Map<string, number>(
  CATEGORIES.map(([name], i) => [name, i]),
);

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
 * Group tools by category and put the groups in `CATEGORIES` order, carrying each
 * category's "Instead of" cell along. Throws if a tool's category isn't listed.
 */
function categoryTable(
  tools: ToolRecord[],
): { category: string; avoid: string; tools: ToolRecord[] }[] {
  const byCategory = new Map<string, ToolRecord[]>();
  for (const t of tools) {
    const cat = t.category ?? "Other";
    const list = byCategory.get(cat) ?? [];
    list.push(t);
    byCategory.set(cat, list);
  }
  for (const cat of byCategory.keys()) {
    if (!CATEGORY_INDEX.has(cat)) {
      throw new Error(
        `categoryTable: category "${cat}" is not in CATEGORIES. ` +
          `Add it in src/docs/render.ts so the docs order and advertise it.`,
      );
    }
  }
  return CATEGORIES.filter(([name]) => byCategory.has(name)).map(
    ([category, avoid]) => ({
      category,
      avoid,
      tools: byCategory.get(category) ?? [],
    }),
  );
}

/**
 * Render the grouped "## Tools" body: one `### Category` table per category, in
 * `CATEGORIES` order, tools in registration order within each. Descriptions are the
 * first sentence of each tool's MCP description (full text lives in docs/tools.md).
 */
export function renderToolsSection(tools: ToolRecord[]): string {
  return categoryTable(tools)
    .map(({ category, tools: list }) => {
      const rows = list
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
// `CATEGORIES` holds it next to the presentation order, and `categoryTable`
// THROWS on an unlisted category — so adding a category forces both.

/** A tool is a "diagnostic" tool if its output carries the triage shape. */
function isDiagnostic(t: ToolRecord): boolean {
  return !!t.outputSchema && "likelyCauses" in t.outputSchema;
}

/**
 * Render the agent-facing rules markdown from the registry. Categories appear in
 * `CATEGORIES` order; tools within each keep registration order. The diagnostic
 * callout is derived from the registry (tools whose output has `likelyCauses`).
 *
 * Throws (via `categoryTable`) if a registry category isn't in `CATEGORIES`, so a
 * new tool group can't ship without a corresponding "use this, not that" row.
 */
export function renderAgentRules(tools: ToolRecord[]): string {
  const rows = categoryTable(tools).map(({ category, avoid, tools: list }) => {
    const use = list.map((t) => `\`${t.name}\``).join(", ");
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
