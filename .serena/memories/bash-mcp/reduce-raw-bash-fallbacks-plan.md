# reduce-raw-bash-fallbacks (planned 2026-06-10, /arch reviewed)

Plan docs ready in `.claude/tasks/reduce-raw-bash-fallbacks/` (spec.md, plan.md, review.md). From brief.md (two issues: composition/output-shaping + shell-script tooling). Brief written without reading the repo — Phase 1 corrected its assumptions.

## Key finding: brief over-scoped Issue 1
Already exist, no work needed:
- `cat` (src/tools/file/file.ts): startLine/endLine (line range), maxLines (head, default 200, 0=unlimited), paths[] (multi-file).
- `rg` (src/tools/search/search.ts): countPerFile (--count-matches), maxResults, maxPerFile, only/replace (extract), filesOnly.

Genuine gaps (this task):
- `run` (src/tools/run/run.ts) is TAIL-ONLY (maxLines = last N); no head/maxBytes; stderr untrimmed.
- `batch` (src/tools/batch/batch.ts) is PARALLEL (Promise.all); no sequential/labeled/dependent ordering.
- No shell-script tools (npm/python/dotnet have *_lint/*_test; shell has none).

## Decisions (AskUserQuestion 2026-06-10, all recommended option)
1. Sequential runner = NEW `run_seq` tool (not a batch mode flag).
2. Shell run/test = SINGLE `bash_test` (parses pass/fail summary when present, else exit-code + trimmed output).
3. Issue 1 scope = `run` shaping + `run_seq` only; SKIP rg grand-total count.

## /arch review (Node stack, frameworks/node.md) — verdict: sound, minimal
- No GoF pattern warranted; design is correct template-replication.
- new-tool and single-bash_test decisions hold up against the decision tree.
- ONE finding folded in => Strand 0: extract shared exec helpers, because gate→exec→trim-output would be copy-pasted across 4 sites (run, batch, run_seq, bash_test) — arch review step 2 "3+ occurrences = extract". Two helpers:
  - `shapeOutput(text,{mode,maxLines,maxBytes})` pure trimming (run/run_seq/bash_test).
  - `runStep({command,args,cwd,timeout})` = checkCommandAllowed→exec→shapeOutput→elapsed (run_seq + batch). Refactor batch.ts to use it => BASH_MCP_MODE gate in ONE chokepoint (security-relevant; spec's top risk).

## Design = pattern-replication
- New `src/tools/shell/` group mirrors `src/tools/python/`: bash_syntax_check (bash -n, readOnly, ENOENT-graceful), bash_lint (shellcheck -f json1, parse like ruff via diagnosticsResponse, graceful if missing), bash_test (mirror python/test.ts).
- Reuse Diagnostic/TestResult (src/parsers/types.ts), diagnosticsResponse + diagnosticInputSchema (src/parsers/diagnostics-response.ts), diagnosticSchema/countBySeverity (src/parsers/schemas.ts).

## Wiring allowlists that MUST be updated together (confirmed from liquibase commit aa4b123)
registry.ts GROUPS (+CATEGORY_ORDER for new "Shell" category); env.ts PROBES + env.test.ts name list (add shellcheck); guidance.ts INTENTS + guidance.test.ts KNOWN_TOOLS set; hooks/bash-mcp-redirect.sh RULES + bash-mcp-redirect.test.ts; index.ts instructions; then `npm run docs:tools` (registry.test.ts + docs:tools --check guard).

## Gotchas
- Commit convention: conventional commits, NO Changelog trailer, NO Co-Authored-By (repo overrides /project:plan template).
- Run tests with `env -u BASH_MCP_MODE npx vitest run` — dev shell BASH_MCP_MODE=off skews safety.test.ts.
- Edit tool needs a prior Read-TOOL read; bash-mcp `cat` does not satisfy it.

## Commit order (lowest→highest)
test(shell) parsers → refactor(exec) shapeOutput+runStep (migrate batch) → feat(run) shaping → feat(run) run_seq → feat(shell) group+wiring → docs.
First execute task = Strand 0 refactor (unblocks the rest), or test(shell) parsers if doing strict TDD.

See `mem:bash-mcp/conventions`, `mem:bash-mcp/next-steps-plans`.