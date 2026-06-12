# Gotchas

## Platform Differences
- `ls.ts` detects macOS vs Linux: macOS lacks `--time-style=iso` flag. Uses `IS_MACOS` constant. Same pattern in `file.ts`.
- `tree.ts`, `find.ts` may have similar platform branches — check before modifying.

## exec() Never Rejects
`exec()` always resolves — errors come back as `exitCode !== 0`. Callers must check `result.exitCode` and call `err()` explicitly. No try/catch needed around exec calls.

## Output Format Duality
Every response has BOTH `content[0].text` (for LLM consumption) AND `structuredContent` (typed JSON). The `text` field varies by format param for list tools but `structuredContent` is always the full JSON. Don't assume they're the same.

## Outline Extractors are Regex-Based
The outline system uses regex pattern matching per language, not AST parsing. Works well for structural overview but won't handle every edge case. Each extractor returns `ExtractResult` with `symbols` (structured) and `outline` (formatted string).

## Git Metadata on Outline
The `outline` tool in `file.ts` enriches output with git metadata (branch, commit, mtime) via `getGitMeta()` which calls `findGitRoot()`. This adds extra exec calls per outline request.

## tsgo vs tsc
Build uses `tsgo` (TypeScript Go compiler) for speed and shebang preservation. Typecheck uses standard `tsc --noEmit`. These can diverge — a tsgo build success doesn't guarantee tsc typecheck passes.

## cat does NOT satisfy built-in Edit's read-precondition (cat-register-with-edit-tracking, 2026-06-11)
The built-in `Edit`/`Write` "File has not been read yet" guard is enforced by Claude Code's in-process read-state map, populated ONLY by the built-in `Read` tool. An MCP tool (bash-mcp `cat`) CANNOT register a path as "read" — no MCP tool-result field / annotation / `_meta` / capability, nor MCP resources (ReadMcpResourceTool), nor any setting, updates that client-side state. Verdict: NOT FEASIBLE to make `cat` satisfy Edit (matches the brief's prior). Deliverable is documentation: caveat in `cat` description (`src/tools/file/file.ts` registerFileTools) + server `instructions` (`src/index.ts`) telling users to run built-in `Read` immediately before `Edit`. The external user rule `~/.claude/rules/bash-mcp-tools.md` already carries the carve-out ("Read only before Edit").
