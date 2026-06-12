# bash-mcp
MCP server wrapping CLI tools with structured JSON output instead of raw text.

## Stack
TypeScript, Node.js >= 20 (ESM), MCP SDK, Zod schemas, Vitest, Biome (lint/format), tsup (bundler)

## Key Paths
- src/index.ts — server entry; main() dispatches `--doctor` (runDoctor → print report → exit) BEFORE starting the server, else calls registerAll(server) from src/registry.ts and connects stdio transport
- src/doctor.ts — `bash-mcp --doctor` preflight: runDoctor() returns { checks: Check[], exitCode } (Node version, dist entry, MCP SDK import, PATH, per-CLI availability via env.ts PROBES/runProbe, resolved BASH_MCP_MODE); pure exitCodeFor/formatReport at the edge; injectable DoctorDeps for tests. Critical fails (old Node, SDK not loadable) → non-zero exit; missing CLIs advisory
- src/registry.ts — GROUPS (single tool-group list + README category each) drives registerAll (shared with index.ts) + buildRegistry (collects/categorises ToolRecord[] via no-op server) + renderToolDocs (Zod→markdown for docs/tools.md) + renderReadme (regenerates README's "## Tools" tables from the registry and the "Which tool?" table from guidance INTENTS)
- src/exec.ts — command execution (exec, execJson, execWithStdin), IS_MACOS, TIMEOUT constants; surfaces errorCode/signal/timedOut
- src/tool.ts — defineTool: wraps registerTool with wide-event logging + uniform error catching (all tools use it); folds equivalentCommands into _meta + records each tool in the registry (getRegisteredTools/resetRegistry)
- src/error.ts — ToolError taxonomy + classifyError (missing_binary/timeout/permission_denied/...)
- src/logger.ts — zero-dep structured stderr logger; resolveLevel(BASH_MCP_LOG); logEvent (per-call wide events, level-gated) + logLifecycle (server start/fatal, always emitted, shares static context)
- src/version.ts — single source of the package VERSION (read by index.ts + logger.ts); src/version.test.ts guards it + server.json against package.json (drift-guard pattern)
- src/safety.ts — resolveMode(BASH_MCP_MODE) + classifyCommand + checkCommandAllowed (gates run/batch)
- src/response.ts — MCP response helpers (ok, okList, err); err takes optional 3rd ToolError arg
- src/format.ts — multi-format list output (TSV, columnar, JSON)
- src/shell.ts — shell escaping (shellEscape)
- src/parsers/types.ts — shared interfaces (Diagnostic, TestResult, TestSuite, BudgetParams)
- src/parsers/schemas.ts — shared Zod schemas (diagnosticSchema, testResultSchema, countBySeverity, budgetSchema, applyBudget)
- src/parsers/strip-prefix.ts — generic prefix stripping (paths, namespaces)
- src/parsers/diagnostic-line.ts — generic path(line,col): severity code: msg parser
- src/parsers/json-output.ts — JSON-ish output parser (jq/yq parse cascade)
- src/tools/&lt;category&gt;/&lt;category&gt;.ts — tool implementations, each exports registerXTools(server)

## Tool Inventory
**Environment**: check_environment | **Guidance**: list_guidance | **Filesystem**: ls, tree, du, find_files | **Search**: rg, glob | **Git**: git_status, git_log, git_diff, git_branches, git_diff_content, repo_health_summary, git_pr_context | **Kubernetes**: kube_get, kube_logs, kube_contexts, kube_diagnose_pod, kube_pod_failure_summary, kube_deployment_status, kube_events_summary | **Terraform/OpenTofu**: tf_state_list, tf_show, tf_plan_summary, tf_workspaces, tf_outputs, tf_providers, tf_validate_summary, tf_modules_summary, tf_backend_info (all accept binary: terraform|tofu) | **Helm**: helm_list, helm_status, helm_values, helm_release_triage | **ArgoCD**: argo_apps, argo_app_detail, argo_app_diff, argo_app_health_summary | **JSON/YAML**: jq, yq | **File**: cat, outline | **Run**: run, run_seq | **Batch**: batch | **npm**: npm_lint, npm_test, npm_typecheck | **dotnet**: dotnet_build, dotnet_test | **Liquibase**: liquibase_validate, liquibase_update_sql, liquibase_status | **Python**: python_lint, python_test, python_typecheck | **Shell**: bash_syntax_check, bash_lint, bash_test

Diagnostic tools (kube_diagnose_pod, *_summary, helm_release_triage, argo_app_health_summary, repo_health_summary) return `{ status/healthy, likelyCauses[], suggestedNextCommands[], evidence[] }` — collapse multi-call triage into one answer.

## Adding a New Tool
See docs/adding-tools.md

## Conventions
- Subpath imports: #exec, #response, #shell, #format, #parsers, #tool, #error, #logger, #safety (package.json "imports")
- Register tools via `defineTool(server, name, config, handler)` from #tool — NOT server.registerTool directly (defineTool adds wide-event logging + error catching)
- Read-only tools carry `annotations: { readOnlyHint: true }` in their config object
- Add `equivalentCommands: ["..."]` to a tool's config for the raw CLI it approximates — set this by default for any tool wrapping a real CLI; leave it unset only when the tool maps to no single CLI invocation (e.g. batch, list_guidance, outline, tf_modules_summary, tf_backend_info). defineTool folds it into MCP `_meta` and the generated docs/tools.md; new groups must be added to the `GROUPS` table in src/registry.ts (NOT index.ts directly), giving each a README category. `npm run docs:tools` regenerates docs/tools.md, the README generated regions (`<!-- BEGIN/END GENERATED: tools|which-tool -->` — grouped tool tables + the "Which tool?" intent table), AND the agent-facing rules file `claude/rules/bash-mcp-tools.md` (via `renderAgentRules` — one row per registry category; `CATEGORY_AVOID` in src/registry.ts holds the curated "instead of" cell and a missing entry throws); run it after touching a tool's title/description, `equivalentCommands`, the `GROUPS` table, or guidance `INTENTS`, or the registry guard test fails. The README table blurbs are the first sentence of each tool's description — keep that sentence self-contained
- A new tool with `equivalentCommands` must also get a `RULES` entry in `hooks/bash-mcp-redirect.sh` (or an `EXEMPT` reason in hooks/bash-mcp-redirect.test.ts) — the registry↔hook parity test enforces it. `scripts/install-claude-assets.mjs` (`npm run claude:install`, `npm run claude:check`) copies the generated rules file + hook into `~/.claude/`
- All schemas: Zod (inputSchema, outputSchema)
- All tools return: { content: [{ type: "text", text }], structuredContent: {...}, isError?: true }
- Co-located tests: &lt;name&gt;.test.ts next to &lt;name&gt;.ts; pure parsers extracted to parse.ts/diagnose.ts with fixture-driven tests reading from fixtures/
- Build with tsup (single-file bundle with shebang), dev with tsx (fast reload)
- Shared parser types in src/parsers/types.ts — reuse Diagnostic/TestResult/TestSuite across tool groups
- Shared Zod schemas in src/parsers/schemas.ts — use diagnosticSchema/testResultSchema in outputSchema; spread budgetSchema + call applyBudget for variable-size lists
- Timeouts use TIMEOUT constants from src/exec.ts (DEFAULT, INFRA, BUILD, TYPECHECK)

## Env Vars
- BASH_MCP_LOG: error (default, only failed calls) | info (adds successes) | off/silent. Wide-event JSON to stderr; run/batch args redacted.
- BASH_MCP_MODE: readOnly (default, blocks mutating run/batch) | confirmWrites | off (no enforcement) | dangerous. Gates run/batch mutating commands; set off for trusted local use.
- TF_BINARY: terraform (default) | tofu. Default binary for tf_* tools.

## Timeouts (TIMEOUT constants in src/exec.ts)
DEFAULT: 30s (filesystem/search/git) | INFRA: 15s (kube/helm/argocd) | TYPECHECK: 60s (tsc, tf show) | BUILD: 120s (dotnet, npm test, tf plan) | All: 10 MB maxBuffer

## Commands
Build: npm run build | Dev: npm run dev | Test: npm test | Lint: npm run lint | Typecheck: npm run typecheck | Tool reference: npm run docs:tools (regenerates docs/tools.md + README generated regions + claude/rules/bash-mcp-tools.md; `-- --check` fails if stale) | Install agent assets: npm run claude:install (copies rules + hook into ~/.claude; `claude:check` for dry-run)

## Prerequisites
Node.js >= 20 always required. Per-category: rg (ripgrep), git, kubectl, terraform, helm, argocd, jq, yq (mikefarah), dotnet, liquibase, ruff, mypy, pytest, shellcheck, bats. Tools error gracefully if CLI missing.
