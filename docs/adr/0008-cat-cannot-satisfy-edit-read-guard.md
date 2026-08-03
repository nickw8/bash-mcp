# ADR-0008: `cat` cannot satisfy the built-in Edit read guard — documented, not worked around

- **Status:** Accepted (investigated and closed as not feasible)
- **Date:** 2026-06-11 (cat-register-with-edit-tracking)

## Context

Claude Code's built-in `Edit`/`Write` refuse to touch a file with "File has not been read
yet". Agents told to prefer bash-mcp `cat` over the built-in `Read` then hit that guard and
have to read the file twice, which cancels the token saving `cat` exists to deliver.

## Decision

Investigated whether an MCP tool can register a path as read. It cannot: the guard is
enforced by Claude Code's in-process read-state map, populated **only** by the built-in
`Read` tool. No tool-result field, annotation, `_meta` entry, capability, MCP resource
(`ReadMcpResourceTool`), or setting updates that client-side state.

Ship documentation instead of a workaround: a caveat in the `cat` tool description
(`src/tools/file/file.ts`), the same caveat in the server `instructions`
(`src/index.ts`), and a carve-out in the generated agent rules — use the built-in `Read`
immediately before editing a file, `cat` for everything else.

## Consequences

- The double read before an edit is expected behaviour, not a bug to re-investigate.
- Reopen only if Claude Code exposes a way for an MCP tool to mark a path as read.
- The `cat`-over-`Read` guidance keeps its exception, and the exception has to survive
  every regeneration of the agent rules file.
