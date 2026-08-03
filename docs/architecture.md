# Architecture

Read when tracing how a request flows through the server, or when you need to know which
module owns a concern before editing.

## Stack

TypeScript, Node.js >= 20 (ESM), MCP SDK, Zod schemas, Vitest, Biome (lint/format), tsup (bundler)

## Key Paths

- src/index.ts — server entry; main() dispatches `--doctor` (runDoctor) and `--install-claude [--check]` (installClaudeAssets) — print report → exit — BEFORE starting the server, else calls registerAll(server) from src/registry.ts and connects stdio transport
- src/doctor.ts — `bash-mcp --doctor` preflight: runDoctor() returns { checks: Check[], exitCode } (Node version, dist entry, MCP SDK import, PATH, per-CLI availability via env.ts PROBES/runProbe, resolved BASH_MCP_MODE); pure exitCodeFor/formatReport at the edge; injectable DoctorDeps for tests. Critical fails (old Node, SDK not loadable) → non-zero exit; missing CLIs advisory
- src/install-claude.ts — `bash-mcp --install-claude [--check]`: installClaudeAssets() copies claude/rules/bash-mcp-tools.md + hooks/bash-mcp-redirect.sh into ~/.claude (or reports drift), returning { results, exitCode, missingSource? }; pure formatInstallReport/hookSnippet at the edge; injectable InstallDeps for tests. Path resolution (dirname(dirname(import.meta.url))) works from src (tsx) and the dist bundle, so npm-installed consumers run it via `npx @nickw8/bash-mcp --install-claude` without a clone. scripts/install-claude-assets.mjs is a thin tsx wrapper over the same module (npm run claude:install/claude:check)
- src/registry.ts — GROUPS (single tool-group list + README category each) drives registerAll (shared with index.ts) + buildRegistry (collects/categorises ToolRecord[] via no-op server, one group at a time). Boot path only; no rendering
- src/docs/render.ts — the renderers over a ToolRecord[]: renderToolDocs (Zod→markdown for docs/tools.md), renderReadme/renderToolsSection/renderWhichToolTable (README's "## Tools" tables from the registry, "Which tool?" from guidance INTENTS), renderAgentRules (claude/rules/bash-mcp-tools.md). One `CATEGORIES` table owns both the presentation order and each category's "Instead of" cell; `categoryTable` throws on a category that isn't in it. Imported only by scripts/gen-tool-docs.mjs and src/docs/render.test.ts
- src/exec.ts — spawn only: exec, execJson, TIMEOUT constants; surfaces errorCode/signal/timedOut. `exec`'s `stdin` option writes a document down the child's pipe (how jq/yq/kube_get --jq are fed) — no module here builds a shell string. execJson also returns `detail` — the failure already classified through error.ts — because those raw fields are otherwise lost to a JSON caller
- src/shape.ts — Shaping (shapeOutput): trimming output to a head/tail line + byte window. Text in, text out
- src/step.ts — runStep: the guarded step runner shared by run_seq and batch (gate → spawn → shape)
- src/platform.ts — BSD vs GNU coreutils flags in one place: statArgs(fields, paths), lsTimeArgs, IS_MACOS
- src/tool.ts — defineTool: wraps registerTool with wide-event logging + uniform error catching (all tools use it); folds equivalentCommands into _meta + records each tool in the registry (getRegisteredTools/resetRegistry)
- src/error.ts — ToolError taxonomy + classifyError (missing_binary/timeout/permission_denied/...)
- src/logger.ts — zero-dep structured stderr logger; resolveLevel(BASH_MCP_LOG); logEvent (per-call wide events, level-gated) + logLifecycle (server start/fatal, always emitted, shares static context)
- src/version.ts — single source of the package VERSION (read by index.ts + logger.ts); src/version.test.ts guards it + server.json against package.json (drift-guard pattern)
- src/safety.ts — resolveMode(BASH_MCP_MODE) + classifyCommand + checkCommandAllowed (gates run/batch)
- src/response.ts — MCP response helpers (ok, okList, err); err takes optional 3rd ToolError arg
- src/format.ts — multi-format list output (TSV, columnar, JSON)
- src/parsers/index.ts — the `#parsers` barrel; import shared parser code through the subpath, never `../../parsers/x.js` (a group has its own `src/tools/&lt;group&gt;/parsers/`, so the relative form is ambiguous)
- src/parsers/types.ts — shared interfaces (Diagnostic, TestResult, TestSuite, BudgetParams)
- src/parsers/schemas.ts — shared Zod schemas (diagnosticSchema, testResultSchema, countBySeverity, budgetSchema, applyBudget) + the Triage envelope, declared once as a Zod object and exposed both ways: `triageSchema` (its `.shape`, spread into outputSchema) and `type Triage` (its `z.infer`)
- src/parsers/diagnostics-response.ts — diagnosticsResponse + the input/output schema fragments shared by the diagnostic-emitting tools (typecheck/lint/build)
- src/parsers/strip-prefix.ts — generic prefix stripping (paths, namespaces)
- src/parsers/diagnostic-line.ts — generic path(line,col): severity code: msg parser
- src/parsers/json-output.ts — JSON-ish output parser (jq/yq parse cascade)
- src/tools/&lt;group&gt;/payload.ts — the CLI payload: the subset of that CLI's `-o json` output the group reads, one declaration per command, every field optional (Kubernetes keeps its KubeResource/KubeList in parse.ts)
- src/tools/kube-args.ts — the `#kube-args` subpath: inputs the kubectl and helm groups share. kubectlContext (`--context`) / helmContext (`--kube-context`) — the same input spelled differently per CLI, argocd deliberately absent because its `--kube-context` only applies under `--core` — plus namespaceSchema, whose Zod default is why a handler never needs `namespace ?? "default"`
- src/tools/&lt;category&gt;/&lt;category&gt;.ts — tool implementations, each exports registerXTools(server)

## Data flow

1. MCP request → `defineTool` wrapper → handler receives Zod-validated params
2. Handler builds CLI args, calls `exec(command, args, options)` — the only process-spawn seam
3. Handler parses stdout, usually via a pure parser module (`parse.ts` / `diagnose.ts`)
4. Returns `ok()` / `okList()` / `err()`; `defineTool` emits one wide event in `finally`

`run_seq` and `batch` share `runStep` (`src/step.ts`) —
`checkCommandAllowed` → `exec` → `shapeOutput` → elapsed — so the safety gate has exactly
one chokepoint. `run` gates itself (it reports the block differently) and calls `exec` +
`shapeOutput` directly.

## Subsystem notes

- **Outline** (`src/tools/file/outline/`) — one regex extractor per language, dispatched by `EXT_MAP` / `EXTRACTORS`, returning `ExtractResult`. Regex, not AST: [ADR-0007](adr/0007-outline-extractors-are-regex.md).
- **Git Source** (`src/tools/file/git-source.ts`) — how `cat --ref` and `outline --ref` read a file out of git: `resolveRepo` (the one `rev-parse`), `readAtRef`, `gitMeta`. Locating the repo is a separate call because it is the spawn; a handler resolves once and passes the `Repo` to the rest. `outline` also pays `gitMeta`'s two spawns per request to enrich its payload with branch and commit.
- **Redirect hook** — `hooks/bash-mcp-redirect.sh` is a PreToolUse Bash hook steering agents from raw commands to tools via a `RULES` array (block = a tool exists, warn = compound or roadmap). `hooks/bash-mcp-redirect.test.ts` asserts every `RULES` entry plus the write-passthrough, pipeline-demote, and fail-open invariants; the vitest include covers `hooks/`. Test files are excluded from the npm tarball via `"!hooks/**/*.test.ts"` in package.json `files`.
- **Platform branches** — BSD and GNU coreutils take different flags for the same information (macOS `ls` has no `--time-style=iso`; `stat` is `-f "%z"` vs `--format=%s`). All of it lives in `src/platform.ts` — `statArgs()` and `lsTimeArgs`. A tool that formats dates or sizes asks for the fields it wants; it does not branch on the platform itself.
- **Build** — tsup bundles to a single `dist/index.js` with shebang; Zod is inlined, the MCP SDK stays external. Typecheck is a separate `tsc --noEmit` — a successful build does not mean a clean typecheck. `js-tiktoken` is a devDependency used only by `scripts/token-benchmark.mjs` and is not bundled. `npm link` puts `bash-mcp` on PATH.
