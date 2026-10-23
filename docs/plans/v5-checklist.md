# v5 Implementation Checklist

Persistent tracker for the token-optimization / universal-publishing / agent-integration
work. Survives context resets: read this first, update it in the same commit as the work.
Decisions live in the **Decisions** log at the bottom; the audit and measurements are in
[v5-audit.md](v5-audit.md).

Branch: `feat/v5`. Baseline: `fixtures/benchmarks/baselines/v4.0.0.json` (immutable,
hash-pinned by `src/benchmark.baseline.test.ts`; commit `fc85b47`).

Legend: `[x]` done and verified · `[~]` done with a documented gap · `[ ]` open · `[-]` decided against (see Decisions)

## Phase 0 — Audit and baseline
- [x] Audit repo, SDK, protocol, exec, safety, budget, benchmarks, CI, installer
- [x] Run tests (905 pass / 82 files) and benchmark at v4.0.0
- [x] Measure tool-schema footprint (`scripts/schema-footprint.mjs`)
- [x] Freeze baseline (`scripts/capture-baseline.mjs v4.0.0`)
- [x] Write audit report (`docs/plans/v5-audit.md`)

## Phase 1 — Universal MCP publishing
- [x] `server.json`: name `io.github.nickw8/bash-mcp`, identifier `@nickw8/bash-mcp`, current schema
- [x] `package.json`: `mcpName`
- [x] Identity consistency test (package.json ↔ server.json ↔ version.ts)
- [x] Validate with official `mcp-publisher`
- [x] Release workflow: gates → npm (OIDC, provenance, skip-if-published) → registry (GitHub OIDC, skip-if-published) → verify → summary
- [x] CI: add benchmark gate + package verification
- [x] Installation guide for Claude Code, Claude Desktop, Cursor, VS Code/Copilot, Codex, generic
- [x] stdout-only-protocol check (stdio test asserts no non-JSON stdout)

## Phase 2 — Adaptive token optimization
- [x] Central response budget in `defineTool` (`auto|summary|compact|full`, `BASH_MCP_RESPONSE_MODE`)
- [x] Budget truncation is schema-safe and explicit (`retained` block, never silent)
- [~] Rework negative-saving tools where it does not hurt downstream use (D3)
- [x] Diagnostic summaries: dedupe repeated findings, deterministic ordering, documented
- [x] Before/after fixture benchmark

## Phase 3 — Progressive disclosure
- [x] In-memory result store: TTL, entry/byte caps, opaque ids, session-bound
- [x] `result_get` retrieval tool (path / offset / limit)
- [x] Expired / invalid / foreign-session handles → typed error
- [x] Consistency guarantees documented (snapshot semantics)

## Phase 4 — Tool discovery and context overhead
- [x] Declarative tool profiles (`BASH_MCP_PROFILE=core|development|infrastructure|all`)
- [x] Invalid profile fails fast with a stderr message
- [x] Trim shared schema descriptions; measure before/after
- [~] Document client-native deferred discovery (Claude Code tool search, Bedrock) (D13)

## Phase 5 — Diagnostic workflows and execution safety
- [~] Map requested workflows to existing diagnostics; add only what is justified (D10)
- [x] Cancellation: MCP request abort signal reaches the child process
- [x] Process-group kill on timeout/abort/server exit (POSIX)
- [x] Tests: cancellation, cleanup, timeout

## Phase 6 — Agent integration
- [x] Claude Code plugin + marketplace manifest (server + optional hook)
- [x] Hook mode configurable (`BASH_MCP_HOOK=block|warn|off`)
- [x] `--uninstall-claude`
- [x] Client config examples + smoke tests

## Phase 7 — Benchmarking and regression gates
- [x] Wire-level (full CallToolResult) measurement alongside payload
- [x] Task-level deterministic evaluation (6 scenarios)
- [~] Opt-in live-agent evaluation harness (not in PR CI) (D11)
- [x] Regression gate vs baseline (fixtures + schema footprint, thresholds + exceptions)
- [x] Before/after report

## Phase 8 — Docs and release readiness
- [x] README, configuration, architecture, ADRs, CHANGELOG, migration notes
- [x] Full validation pass (see v5-audit.md §Verification)
- [~] Release recommendation (D12)

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Baseline is a frozen JSON snapshot, not a copy of the fixtures | `expected.txt` files are a behavioural contract (ADR-0010) and must change with handlers; the numbers they produced at v4.0.0 must not. Git tag `v4.0.0` holds the old files. |
| D2 | Two schema footprints: `wire` (whole `tools/list`) and `model` (`name`+`description`+`input_schema`) | Anthropic tool definitions carry no outputSchema; 8k of the 23.7k wire tokens never reach the model. Reporting only `wire` would make outputSchema trimming look like a context win. |
| D3 | `rg` emits `truncated` only when true; the other eight net-negative tools keep their shape | Their deficit is JSON punctuation on 3–7 item fixtures (the scaling table shows it never amortizes). A text-encoded payload would break typed consumers for tens of tokens; the large-output win comes from the budget instead. |
| D4 | `retained` is an open record in output schemas | Every tool's outputSchema would otherwise need its own copy; an open record keeps schema cost flat (model tokens fell 2%). |
| D5 | The text block is budgeted too (`capText`) | A client that forwards `content[]` would otherwise pay the full output even when the payload was cut. |
| D6 | `BASH_MCP_PROFILE` defaults to `all` | An upgrade must not silently drop tools; profiles are opt-in. |
| D7 | `exec` moved from `execFile` to `spawn` with `detached` process groups | `execFile` drops `detached`, so `kill(-pid)` failed with ESRCH and grandchildren survived timeouts. |
| D8 | Diagnostics: exact-repeat dedupe plus a severity-aware cut; kept items stay in CLI order | Sorting errors first reordered findings inside a file and broke the npm_lint/bash_lint contract fixtures; the cut alone keeps errors without reordering. |
| D9 | Hook default: script `block`, plugin `warn` | Manual installers opted in to blocking; a plugin installed from a marketplace must never block unconditionally. |
| D10 | No new diagnostics | Every requested workflow maps to an existing tool: k8s → `kube_pod_failure_summary`/`kube_diagnose_pod`, CI → `glab_pipeline_failure_summary`/`gh_run_failure_summary`, .NET → `dotnet_build`/`dotnet_test`, Terraform → `tf_plan_summary`, MR → `git_pr_context`, source → `rg`/`outline`. The task eval covers all six. |
| D11 | Live eval drives the external `claude` CLI and is never run in CI | No model inside bash-mcp; runs are billed and non-deterministic. Shipped but not run in this work. |
| D12 | Recommend 5.0.0; no version bump or publish without explicit authorization | Breaking: default budget, `rg.truncated`, fail-fast env values. |
| D13 | Bedrock tool-search behaviour documented as inference | Not measured; flagged as such in tool-discovery.md. |
| D14 | Flat-list rows become positional tuples, not maps | The budget and `result_get` cut arrays only. Applies to du, git_branches, ls, tf_outputs, tf_state_list and rg. bash_test, python_typecheck and bash_syntax_check are left as they are: their shapes are shared, and their counts are taken before filtering. Corpus 4,458 → 4,298; net-negative tools 9 → 7. |
| D15 | Repeated lines merge only when adjacent, compared without a leading timestamp, and are marked ` [×N]` | Keeps the order of events. Applies to the shaped output of run/run_seq/batch, kube_logs, and gh/glab evidence. The `kube_logs_repeats` fixture is synthetic and labelled as such. Only `run` has an opt-out (`collapse: false`). |
| D16 | `kube_logs` rows are strings, `"<timestamp> <message>"`; `count` and `pod` dropped | Per-line objects cost 13% over raw on 400 lines; strings cost 0%. A string is what kubectl prints, and `lineKey` still finds the message for grep and merging. `budgetTail` keeps the newest lines (ADR-0017). |
| D17 | Budget rows are atomic | A cut inside a tuple breaks `outputSchema`. `rg` rows are bounded by `maxResults`/`maxPerFile` instead. |
