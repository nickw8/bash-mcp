# Conventions

## Tool Registration Pattern
Register via `defineTool` (from `#tool`), NOT `server.registerTool` directly — defineTool injects wide-event logging + uniform error catching:
```
export function register<Name>Tool(server: McpServer) {
  defineTool(server, "<tool_name>", {
    title: "...",
    description: "...",
    inputSchema: { ...zod },
    outputSchema: { ...zod },          // optional; validated on success path only
    annotations: { readOnlyHint: true }, // for read-only tools
    equivalentCommands: ["raw cli ..."], // optional; raw CLI this tool approximates
  }, async (params) => {
    // Build CLI args → exec() → parse stdout → ok()/okList()/err()
  });
}
```
Group barrels collect individual tools: `registerFilesystemTools` calls `registerLsTool`, etc. Wire the barrel into the `GROUPS` table in **src/registry.ts** (the single shared tool-group list, each entry { category, register } — `registerAll` iterates it and src/index.ts calls registerAll; do NOT add register* calls to index.ts directly). The `category` is the README section the group's tools appear under (multiple groups may share one, e.g. git.ts + diff.ts → "Git", json.ts + yaml.ts → "Data Processing").

## Tool Registry & Generated Docs (tool-reference-and-transparency + capstone, 2026-05-31)
- `defineTool` folds `equivalentCommands` into the tool's MCP `_meta` (preserving any caller `_meta`; the field is stripped from the config the SDK sees) AND pushes a flattened `ToolRecord` ({name,title,description,readOnlyHint,equivalentCommands,inputSchema,outputSchema,category?}) into a module-level registry. Read via `getRegisteredTools()`; clear via `resetRegistry()`. `category` is NOT set by defineTool (group-agnostic) — `buildRegistry()` tags it from the GROUPS table.
- `src/registry.ts`: `GROUPS` (the { category, register } table) drives `registerAll(server)`; `buildRegistry()` (resetRegistry → register all against a no-op stub server, tagging each new ToolRecord's category from its group → return `[...getRegisteredTools()]`; reset-first so live server + in-process generator/test don't double-count).
- Renderers in registry.ts (all deterministic, pure): `renderToolDocs(tools)` → docs/tools.md (tools sorted by plain `<`/`>` name compare; minimal custom Zod→type printer via `_def.typeName`, no zod-to-json-schema dep). `renderToolsSection(tools)` → README "## Tools" grouped tables (category order = CATEGORY_ORDER const, tools in registration order, blurb = FIRST SENTENCE of description). `renderWhichToolTable(intents)` → README "Which tool?" table from guidance INTENTS (strips `run: ` prefix from avoid entries; shows ALL avoid entries verbatim incl. raw-binary self-refs like rg/cat). `renderReadme(readme, tools, intents)` = idempotent transform that rewrites the two marked regions and returns the whole file.
- README generated regions are delimited by `<!-- BEGIN/END GENERATED: tools -->` and `<!-- BEGIN/END GENERATED: which-tool -->`. The `tf_*` binary note + the docs/tools.md link blockquote live OUTSIDE the markers (hand-prose).
- Generator `scripts/gen-tool-docs.mjs` (run under tsx so TS imports resolve): `npm run docs:tools` rewrites BOTH docs/tools.md (whole-file) AND the README regions (region-replace); `-- --check` exits non-zero if EITHER is stale (CI).
- CI guard `src/registry.test.ts`: committed `docs/tools.md` == `renderToolDocs(buildRegistry())` AND committed README == `renderReadme(readme, buildRegistry(), INTENTS)` (both idempotent); plus category-tagging + renderer unit tests. Seeded equivalentCommands: kube_get, kube_diagnose_pod, kube_pod_failure_summary, kube_deployment_status, git_pr_context, repo_health_summary, tf_plan_summary, helm_release_triage, argo_app_health_summary. **After adding/changing a tool's title/description/equivalentCommands, the GROUPS table, or guidance INTENTS, re-run `npm run docs:tools` or the guard fails.** README table blurbs = first sentence of description → keep that sentence self-contained.
- No remaining hand-maintained tool lists; INTENTS↔README sync risk eliminated.

## readOnlyHint
Read-only/inspection tools carry `annotations: { readOnlyHint: true }`. EXCLUDED (mutating/arbitrary exec): run, batch, npm_lint/python_lint (have --fix), npm_test/python_test/dotnet_test/dotnet_build.

## Response Conventions
- Success: `ok(structured)` single-value, `okList(structured, rows, meta, format)` list tools
- Error: `err(message, emptyStructured)` — always returns structured shape; optional 3rd `ToolError` arg merges `{ok:false, error}` (backward-compatible)
- List tools accept `format`: "json" | "tsv" | "columnar" | "bare" | "grouped" (`#format` ListFormat). `bare` = headerless TSV (single-column ≈ raw); `grouped` = group rows by first column, header once (ripgrep-style — default for rg + diagnostic tools). `formatList` uses the UNION of keys across ragged rows and omits low-signal meta (false/null/undefined/"").
- List tools also accept `fields: string[]` → `okList(s, rows, meta, fmt, { fields })` projects the text block to those columns only (structuredContent keeps all). Add it to multi-column list tools.
- Flat-list tools default to a COMPACT text block (NOT `ok()`/JSON): `bare` for single-column (tree, tf_state_list, glob), `tsv` for multi-column (ls, du, git_log, git_branches, tf_outputs, kube_contexts), `grouped` for rg. `ok()` puts full JSON in the text block — only the text block is token-counted by the model, so flat lists must use `okList`.
- `okList(structuredContent, rows, meta, format)`: `structuredContent` stays schema-complete; `rows`/`meta` drive the compact text. So curate `rows` (drop derived/redundant fields — e.g. du sizeHuman, git_log full hash, tf_state_list type/name/module, all-false git_branches remote) WITHOUT changing outputSchema/structuredContent.
- `formatList` meta values JSON-encode objects/arrays (e.g. tf_state_list byType rollup goes in meta).
- kube_get flattens summarized items for the text view (extra map → top-level columns; labels stay in structuredContent). All flat-list tools now compact-default, incl. kube_get.
- cat accepts `paths: string[]` (multi-file, returns { files, count }; per-file `error`, never aborts batch) in addition to single `path`. Core read logic is the module-level `readFileContent` helper.
- Variable-size list tools: spread `...budgetSchema` into inputSchema, call `applyBudget`; emit total/truncated ONLY when a budget param is passed (keeps no-param shape unchanged)

## Diagnostic Tools (typecheck/lint/build)
- npm_typecheck, python_typecheck, python_lint, dotnet_build all parse a `Diagnostic[]` and MUST return via the shared `diagnosticsResponse(structuredContent, diagnostics, opts)` from `src/parsers/diagnostics-response.ts` — NOT `ok()`. It routes the text block through `okList` with a grouped-by-file default (file header once, then `line:col rule message`), keeps `structuredContent` as the full typed payload.
- `diagnosticRows` curation: collapse `line`/`column` into one `loc` cell; drop `severity` when uniform across the set (include only when mixed); drop `rule` when absent.
- Spread `...diagnosticInputSchema` (format: grouped|tsv|json, fields, detailLevel, maxItems) into the tool's inputSchema; pass `{ format, fields, budget: { detailLevel, maxItems }, meta: { errorCount, ... } }`. Budget caps cascades; truncation adds `shown`/`total` meta.
- Flipped npm_typecheck −18%→+36%, dotnet_build +31%→+74%.

## rg specifics
- Default format is `grouped` (native-ripgrep style); `filesOnly` defaults to `bare`, `countPerFile` to `tsv`.
- Matched line text is trimmed of leading indentation and windowed around the match via `windowMatchText` (src/tools/search/window.ts) using rg submatch offsets — param `maxLineLength` (default 300, 0 = unlimited) so long/minified lines don't dump in full.
- `context` lines (rg JSON `type:"context"`) ARE emitted (previously dropped): marked with a trailing `-` on the line number in text; `kind: "match"|"context"` carried in structuredContent only when context requested.

## Benchmarks
- Source of truth: `fixtures/benchmarks/` — per-tool `raw.txt` (CLI capture) + `expected.txt` (bash-mcp text block) + `manifest.json` ({ id, command, weight, budget }). `scripts/token-benchmark.mjs` reads these; `--write` regenerates the tables in `docs/token-benchmarks.md` (between `<!-- BENCHMARK:... -->` markers). Rendering/aggregation in `scripts/benchmark-core.mjs` (shared with the test).
- Two CI guards: `src/format.budget.test.ts` (synthetic rows → formatList ≤ budget AND < JSON, guards the formatter code) and `src/benchmark.fixtures.test.ts` (each tool's expected.txt ≤ recorded manifest budget; doc tables still match fixtures — doc can't drift). Budget = ceil(o200k(expected)*1.1). When intentionally changing a tool's output: update expected.txt, re-baseline budgets, re-run `--write`.
- Current aggregate: ~41% token-weighted, ~34% median, ~42% frequency-weighted (o200k proxy). Several tools are legitimately negative on tiny fixtures (tf_state_list −97%@5rows, rg −13%, git_branches −11%, tf_outputs −4%) — small-sample fixed-overhead that amortizes; kept enabled (documented in token-benchmarks.md "What's still negative").

## File Organization
- One tool per file, named after the tool (`ls.ts` for `ls`)
- Barrel per category: `filesystem.ts`, `git.ts`, `npm.ts`
- Tests co-located: `*.test.ts` next to implementation
- Extract pure parsing into `parse.ts`/`diagnose.ts` etc. with fixture-driven tests reading `fixtures/<tool>/`; parsers must never throw on malformed input
- Outline extractors under `file/outline/` with shared types in `types.ts`

## Env Vars
- BASH_MCP_LOG: error (default) | info | off/silent — wide events to stderr
- BASH_MCP_MODE: readOnly (default — blocks mutating run/batch) | confirmWrites | off (no enforcement) | dangerous. Unset → readOnly. Set off for trusted local use. (changed 2026-05-31; was off)
- TF_BINARY: terraform (default) | tofu — default for tf_* tools

## Build
- tsup for production build (preserves shebang for CLI usage)
- tsx for dev (fast reload via `npm run dev`)
- ESM-only (`"type": "module"`)
- Build uses tsgo/tsup; typecheck uses tsc separately — run `npm run typecheck` explicitly (a build pass does not guarantee typecheck)

## Imports
Subpath imports for core modules: `#exec`, `#response`, `#shell`, `#format`, `#parsers`, `#tool`, `#error`, `#logger`, `#safety`. Tool files import `@modelcontextprotocol/sdk` and `zod` directly.

## Commit Style
Conventional Commits (feat/fix/chore/docs/refactor/test). NO Co-Authored-By, NO Changelog trailers (GitHub repo). One concern per commit; commit only when asked.
