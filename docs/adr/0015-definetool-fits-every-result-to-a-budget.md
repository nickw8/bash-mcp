# ADR-0015: defineTool fits every result to a budget, and keeps what it cut

- **Status:** Accepted
- **Date:** 2026-10-23 (v5)
- **Relates to:** [ADR-0001](0001-definetool-wraps-every-registration.md),
  [ADR-0009](0009-structuredcontent-is-what-the-agent-reads.md),
  [ADR-0012](0012-the-text-block-is-a-summary.md)

## Context

Before v5, size control lived in each tool: `detailLevel`/`maxItems` on list tools, a
line cap on `cat` and `kube_logs`. A tool without one could return anything. A
2,000-resource `tf_state_list` was ~25k tokens, at Claude Code's MCP output limit. A
cap that a tool applies silently loses data the agent cannot get back without running
the command again.

## Decision

`defineTool` runs every result through `fitToBudget` (`src/budget.ts`) after the
handler. `BASH_MCP_RESPONSE_MODE` sets the limit, and `auto` is the default. Over the
limit, the biggest array is cut to a prefix until the payload fits. The text block is
capped to the same limit. The triage fields `likelyCauses` and `suggestedNextCommands`
are never cut. Every cut is reported in `retained.omitted`.

Unless the store is off, the uncut payload goes to an in-memory, session-scoped
result store (`src/result-store.ts`) with a TTL. `result_get` pages through it.

`retained` is advertised as an open object (`z.record(z.unknown())`), not as its typed
shape. The typed schema cost ~6.4k tokens across `tools/list`. The shape is documented
once, in output-conventions.md.

## Consequences

- No tool can exceed the budget, including tools added later.
- Arrays only. A cut array still matches the tool's `outputSchema`; a cut string would
  read as the whole value.
- A stored result is a snapshot, and nothing invalidates it. It is never written to
  disk. Another session's id answers exactly like an unknown id.
- `full` mode, or `detailLevel: "full"`, gives the v4 behaviour.
