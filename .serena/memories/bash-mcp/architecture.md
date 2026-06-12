# Architecture

## Core Pattern
MCP server over stdio. Entry: `src/index.ts` creates `McpServer`, calls `registerAll(server)` (from src/registry.ts). `main()` first checks `process.argv` for `--doctor`: if present it runs the preflight diagnostic and `process.exit`s BEFORE connecting the transport; otherwise it connects stdio as usual.

## CLI Modes (doctor, added 2026-05-31 doctor-cli theme)
- `src/doctor.ts` — `bash-mcp --doctor` preflight. `runDoctor(deps?) → { checks: Check[], exitCode }` where `Check = { name, ok, critical, detail? }`. Checks: Node major >=20 (critical), dist entry exists (advisory — absent under tsx dev), MCP SDK dynamic import in try/catch (critical), PATH non-empty (advisory), per-CLI availability via env.ts `PROBES`/`runProbe` (advisory), resolved `BASH_MCP_MODE` + recommendation (advisory). Pure `exitCodeFor(checks)` (1 iff any critical fails) and `formatReport(checks)` (✓/✗/• marks) live at the edge; `src/index.ts` only dispatches + prints + exits. `DoctorDeps` injects nodeVersion/probes/probe/distEntry/fileExists/importSdk/mode/path so doctor.test.ts drives every branch without real IO or process.exit. Dist entry resolved as `dirname(dirname(fileURLToPath(import.meta.url)))/dist/index.js` (pkg root is two levels up in both bundle and src). `runProbe`+`ToolStatus` exported from env.ts for this reuse. Report → stdout (safe: exits before any MCP session). Deferred: --help/--version, shebang/exec-bit check.

## Cross-Cutting Layer (added in agent-ops-roadmap)
- `src/tool.ts` — `defineTool(server, name, config, handler)` decorates `server.registerTool`: times the call, try/catch/finally, emits ONE wide event, derives outcome from `result.isError`, converts thrown errors to `err()`. **All tools register via defineTool, not registerTool directly.** Generics mirror registerTool so handler arg types still infer. Also folds `equivalentCommands` into `_meta` and pushes a `ToolRecord` (incl. `category?`, set by buildRegistry) into a module-level registry — see `mem:bash-mcp/conventions` "Tool Registry & Generated Docs".
- `src/error.ts` — `ToolError` discriminated union; `TOOL_ERROR_KINDS` (as const) → `ToolErrorKind`; `classifyError(execResult, command)` precedence ENOENT→timeout→stderr-scan→command_failed; exhaustive `suggestionFor` with `never` arm.
- `src/logger.ts` — zero-dep structured **stderr** JSON logger (stdout is the MCP channel). `resolveLevel(BASH_MCP_LOG)`: default `error` (only failed calls), `info` adds successes, `off`/`silent` disables. Injectable write/level/context for tests. run/batch args redacted (metadata only — no secret leakage).
- `src/safety.ts` — `resolveMode(BASH_MCP_MODE)` (default readOnly as of 2026-05-31; explicit off/dangerous disable gating), `classifyCommand` (const write-rule table), `checkCommandAllowed`. Wired into run + batch; unset/off never block.

## Module Roles
- `src/parsers/types.ts` — shared interfaces (Diagnostic, TestResult, TestSuite, BudgetParams). Importable as `#parsers`.
- `src/parsers/schemas.ts` — shared Zod (diagnosticSchema, testResultSchema, countBySeverity) + `budgetSchema` fragment (detailLevel/maxItems/includeRaw) and `applyBudget(items, params)`. Spread `...budgetSchema` into a list tool's inputSchema; total/truncated emitted ONLY when a budget param is passed (preserves no-param shape).
- `src/exec.ts` — wraps `child_process.execFile` with timeout/maxBuffer defaults (30s/10MB). `exec()` returns `{stdout, stderr, exitCode, errorCode?, signal?, timedOut?}`, `execJson()` parses stdout as JSON. Only process-spawn seam.
- `src/response.ts` — `ok(structured)`, `okList(structured, rows, meta, format)`, `err(message, structured, toolError?)`. err's optional 3rd ToolError arg merges `{ok:false, error}`; 2-arg calls byte-identical. All return `{content, structuredContent, isError?}`.
- `src/format.ts` — `formatList(rows, format, meta)` → formatTsv/formatColumnar/formatJson. TSV default.
- `src/shell.ts` — `shellEscape()`.
- `src/registry.ts` — GROUPS table (tool-group + README category), registerAll, buildRegistry, renderToolDocs/renderToolsSection/renderWhichToolTable/renderReadme. See `mem:bash-mcp/conventions`.

## Diagnostic Tools (roadmap)
Higher-level tools collapse multi-call triage into one answer with shape `{ status/healthy, likelyCauses[], suggestedNextCommands[], evidence[] }`: kube_diagnose_pod, kube_pod_failure_summary, kube_deployment_status, kube_events_summary (src/tools/kubernetes/diagnose.ts + diagnostics.ts), helm_release_triage (helm/triage.ts), argo_app_health_summary (argocd/health.ts), repo_health_summary + git_pr_context (git/parse.ts). Pure logic uses const rule tables; sub-command failures captured in evidence (partial result, not hard error).

## Pure Parsers + Fixtures
Inline parsers extracted to pure modules with co-located fixture-driven tests reading from `fixtures/<tool>/`: kubernetes/parse.ts (summarizeResource/inferStatus/formatAge/parseLogLines/parseContexts), kubernetes/diagnose.ts, terraform/parse.ts, git/parse.ts, argocd/health.ts, helm/triage.ts, env parseVersion. Parsers never throw on malformed input (return safe empty/partial).

## Data Flow
1. MCP request → defineTool wrapper → handler receives typed params (Zod-validated)
2. Handler builds CLI args, calls `exec(command, args, options)`
3. Handler parses stdout into structured data (often via a pure parser module)
4. Returns via `ok()`/`okList()`/`err()`; defineTool emits a wide event in finally

## Tool Organization
Each category is a directory under `src/tools/`. Barrel file (e.g. `filesystem.ts`) exports `register*Tools()` calling per-tool `register*Tool()`. Individual tools in own files (`ls.ts`, `tree.ts`). `env` group: check_environment (client-only parallel probes, never hangs; `PROBES`/`runProbe`/`ToolStatus`/`parseVersion` exported — reused by doctor). `guidance` group (added 2026-05-31, tool-selection-guidance theme): `src/tools/guidance/guidance.ts` — `list_guidance` tool over canonical `INTENTS` const table (`as const satisfies readonly Intent[]`), same shape as env's PROBES → defineTool → ok(). Returns `{ intents:[{intent, preferredTool, category, avoid[], reason}], total }`, filterable by `intent` substring / `category`. readOnlyHint. The README "Which tool should I use?" table is now GENERATED from these same entries via `renderWhichToolTable` (src/registry.ts) — no hand-syncing (capstone done 2026-05-31).

## Liquibase Group (added 2026-06-10, liquibase-tools theme)
`src/tools/liquibase/` mirrors `src/tools/dotnet/` exactly. Three read-only tools: `liquibase_validate`, `liquibase_update_sql`, `liquibase_status` (barrel `liquibase.ts` → `registerLiquibaseTools`). Pure parsers in `parsers/` (banner/validate/update-sql/status + shared `changeset-ref.ts`), fixture-pinned (`fixtures/liquibase/*.txt`). Shared `args.ts` `liquibaseArgs(command, opts)` puts `--defaults-file/--changelog-file` BEFORE the verb and `--labels/--contexts/extraArgs` AFTER. All handlers use `TIMEOUT.BUILD` (DB latency). **Result-vs-error rule:** a validation *failure* is `ok(valid:false)` (the run succeeded, like a failing test); only an unrunnable command is a classified `err` — validate uses `exitCode≠0 && errorCount===0`, status/update_sql use bare `exitCode≠0` (they exit 0 on success). **Two deviations from plan:** (1) contexts/labels are read from each changeset's DATABASECHANGELOG tracking row (positional INSERT tail OR named UPDATE `CONTEXTS=/LABELS=`), NOT the `-- Changeset` marker, which carries none; (2) `liquibase_update_sql` reuses `includeRaw` (from budgetSchema) to attach SQL bodies instead of a separate `verbose` flag. `batchLint` encodes the SQL-Server "routine DDL must lead its GO-batch" rule. Wired through GROUPS/CATEGORY_ORDER, guidance INTENTS (+KNOWN_TOOLS in guidance.test.ts), env PROBES (+env.test.ts list), redirect hook RULES (+test), index.ts instructions, README/CLAUDE.md. Commits 72e8775 (parsers+fixtures) + aa4b123 (handlers+wiring).

## Outline Subsystem (most complex)
`src/tools/file/outline/` — language-specific extractors (TS, Python, C#, SQL, Bash, YAML, XML, Markdown, generic). `index.ts` maps ext → language → extractor via `EXT_MAP`/`EXTRACTORS`. Returns `ExtractResult`.

## Subpath Imports
`#exec`, `#response`, `#shell`, `#format`, `#parsers`, `#tool`, `#error`, `#logger`, `#safety` — package.json `imports`.

## Redirect Hook
`hooks/bash-mcp-redirect.sh` (PreToolUse Bash hook) steers agents from raw commands to MCP tools via a RULES array (block=tool exists, warn=roadmap/compound). Tested in `hooks/bash-mcp-redirect.test.ts` (every RULES entry asserted + write-passthrough/pipeline-demote/fail-open invariants). vitest include covers hooks/. Excluded from the npm tarball via `"!hooks/**/*.test.ts"` in package.json `files`.

## Build
tsup bundles to single `dist/index.js` with shebang. Zod inlined, MCP SDK external. `npm link` puts `bash-mcp` on PATH. js-tiktoken is a devDependency used only by scripts/token-benchmark.mjs (not bundled). `--doctor` SDK-loadable check uses a dynamic `import()` resolved from node_modules at runtime.
