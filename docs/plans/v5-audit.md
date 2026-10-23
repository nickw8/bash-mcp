# v5 Audit and Baseline

State of bash-mcp at **v4.0.0** (commit `fc85b47`), measured 2026-10-23 before any v5 change.
The frozen numbers are in `fixtures/benchmarks/baselines/v4.0.0.json`; this file explains them.
Progress is tracked in [v5-checklist.md](v5-checklist.md).

## Inventory

| Item | Value |
|---|---|
| Package | `@nickw8/bash-mcp` 4.0.0, bin `bash-mcp`, Node >= 20 |
| SDK | `@modelcontextprotocol/sdk` 1.29.0 (latest 1.32.1), negotiated protocol `2025-06-18` |
| Transport | stdio only |
| Tools | 64 across 19 groups (`src/registry.ts` `GROUPS`) |
| Tests | 82 files, 905 tests, all passing (`npm test`) |
| CI | `.github/workflows/ci.yml`: lint, typecheck, test on Node 20 and 22. No release workflow, no benchmark gate |
| Install | `--install-claude [--check]` copies `claude/rules/bash-mcp-tools.md` and `hooks/bash-mcp-redirect.sh` into `~/.claude`. No uninstall |
| Client integrations | Claude Code only (rules file + PreToolUse hook). No plugin, no other client docs |

## Tool-schema footprint (`scripts/schema-footprint.mjs`)

Tokenizer: js-tiktoken `o200k_base` (proxy, not Claude's tokenizer).

| Measure | Tokens |
|---|---:|
| `tools/list` on the wire | 23,722 |
| Model-facing (`name` + `description` + `input_schema`) | 12,973 |
| of which descriptions | 2,644 |
| of which inputSchema | 9,634 |
| outputSchema (wire only) | 8,036 |
| Server instructions | 195 |

The five largest definitions are `rg` 816, `cat` 699, `liquibase_update_sql` 638, `run_seq` 581 and `run` 542.
Shared `format`/`fields`/budget parameters repeat across many tools and make up most of the inputSchema cost.

## Fixture benchmark (`npm run benchmark`)

There are 38 cases: raw CLI output totals 32,571 tokens, the structured payload 4,468.

| Aggregate | Saving |
|---|---:|
| Token-weighted | 86.3% |
| Median per tool | 31.1% |
| Frequency-weighted | 83.1% |

The prose in `docs/guides/token-benchmarks.md` still quotes older figures (59/29/50) even though its tables are current.

### Negative-saving tools

The structured payload costs more than the raw output for these tools:

| Tool | Saving | Cause |
|---|---:|---|
| `tf_state_list` | −112% | resource list repeated as `byType` grouping |
| `rg` | −79% | per-file object wrapping + `truncated:false`; largest weighted excess (248 of 449) |
| `du` | −77% | `{path,sizeBytes}` keys repeated per row |
| `git_branches` | −38% | keyed objects per branch |
| `tf_outputs` | −35% | keyed objects per output |
| `bash_test` | −28% | empty `passed`/`skipped` arrays plus summary |
| `bash_syntax_check` | −21% | grouping overhead on a tiny input |
| `python_typecheck` | −7% | grouping overhead |
| `ls` | −5% | `total` and `path` echo the input |

The scaling fixtures show a floor: a flat list of short rows costs about 11% more as JSON than as text.
Small, already-terse outputs cannot reach a positive saving by reshaping alone. The fix is to stop paying for keys and echoes, not to drop data.

## Gaps against the v5 brief

| Area | Finding |
|---|---|
| Registry identity | `server.json` `name` is `bash-mcp` and the npm identifier is the unscoped `bash-mcp`, which belongs to another author. `package.json` has no `mcpName`. The registry would reject both. |
| Release | No release workflow, no trusted publishing, no registry publish, no post-publish check |
| Response size | `applyBudget` exists but defaults to `full`, and only about 16 tools opt in. Nothing caps a response centrally, and truncation is per-tool and not always reported |
| Follow-up | No way to fetch the rest of a truncated result; re-running the command is the only path |
| Discovery | All 64 tools are always registered; no profiles |
| Cancellation | `exec` ignores the MCP request `AbortSignal`; a cancelled call runs to completion |
| Cleanup | Timeouts kill only the direct child (`execFile`), so grandchildren (e.g. `npm test` workers) can outlive the call |
| Hook | `bash-mcp-redirect.sh` always blocks matching Bash calls; no mode switch |
| Benchmark | Measures `structuredContent` only, not the full serialized `CallToolResult` (content text + structuredContent) |
| Clients | No install docs for Claude Desktop, Cursor, VS Code, Codex |

## Safety posture (unchanged by the audit)

- `BASH_MCP_MODE` defaults to `readOnly` (ADR-0003). It gates `run` and `batch`. Unknown commands fail open, by design, and are documented.
- Every wrapper calls `execFile` with an argv array. There is no shell, so argument injection is limited to flags the wrapper passes through.
- Output from tools is data. bash-mcp never interprets it as instructions; agent-side handling is the client's job, which v5 documents.

## Verification checklist for release

Run all of these before v5 ships:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run docs:tools -- --check`
- `npm run benchmark` and the regression gate against `baselines/v4.0.0.json`
- `node scripts/schema-footprint.mjs` for each profile
- `mcp-publisher validate`
- `npm pack --dry-run`
- the stdio transport test (stdout carries protocol messages only)
- `claude plugin validate .`
