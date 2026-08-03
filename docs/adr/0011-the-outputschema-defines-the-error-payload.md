# ADR-0011: The `outputSchema` defines the error payload

- **Status:** Accepted
- **Date:** 2026-08-03
- **Related:** [ADR-0001](0001-definetool-wraps-every-registration.md), [ADR-0005](0005-wrapped-failure-is-a-result.md), [ADR-0010](0010-the-benchmark-corpus-is-a-contract-corpus.md)

## Context

Every tool declared its payload shape once as `outputSchema`, then hand-wrote a second,
zero-valued copy of it beside each `err(...)` — 55 call sites across 24 files. `err<T>`
infers `T` from the literal it is handed, so the two were never compared. Renaming or adding
a field left every error branch quietly returning the old shape, and the MCP SDK skips
output validation on `isError: true` results, so nothing complained at runtime either.

The error branch is also the path with the least test coverage (ADR-0010), so the drift had
no way to surface: silent by construction, in the one place a caller is already having a bad
time.

## Decision

The declared `outputSchema` is the single definition of a tool's payload, on the success path
and the error path alike.

- `zeroOf(shape)` in `#response` derives the zero-valued payload from the schema:
  `"" / 0 / false / [] / {}` for the primitives and containers, recursion for objects and
  tuples, the declared value for `.default()`, `null` for `.nullable()`, the key omitted for
  `.optional()`, and `null` for anything with no obvious empty value (union, unknown, enum) —
  which is what the hand-written literals already used for those fields.
- `defineTool` computes it once per tool at registration and merges it *underneath* whatever
  the handler returned, for both `err(...)` results and thrown exceptions.
- `err(message, payload?, error?)` therefore carries only what the zero cannot know: the path
  that failed, a pod name, `exitCode: 126`, `status: "Unknown"`. Omit the payload entirely
  when the zero says everything.

Guarded by a registry-driven test: for every registered tool,
`z.object(outputSchema).parse(zeroOf(outputSchema))` must succeed. A schema whose zero can't
satisfy it fails immediately, naming the tool.

## Considered options

- **Export `zeroOf` and call it at each `err` site** (hoisting each `outputSchema` to a named
  const). Rejected: type-links the two but keeps a per-tool hoist and call — the literal is
  replaced, not removed, and a new tool can still skip it.
- **Keep the literals, add a shape-matching test per tool.** Rejected: ~24 new tests for a
  path the SDK does not validate, and each one is a thing to remember rather than a thing
  that happens.
- **Throw at registration for a type `zeroOf` can't map.** Rejected: turns an error-path
  cosmetic into a boot failure. The `null` fallback plus the handler override covers it.

## Consequences

- A schema edit propagates to every error branch for free. There is nothing left to keep in
  sync, so the drift class is gone rather than guarded.
- `defineTool` now rewrites `structuredContent` on error results. That is the surprising part:
  a handler returning `err("boom")` produces a full payload. It is consistent with ADR-0001 —
  `defineTool` is where the cross-cutting concerns live — but it means the handler's return
  value is not verbatim what the client sees on the error path.
- Roughly 100 lines of restated literals deleted, and four hoisted `empty` / `emptyRg` /
  `emptySingle` consts with them.
- A payload key that legitimately differs from its zero on failure (`status: "error"`,
  `noChanges: true`, `language: "unknown"`) is now visible at the call site instead of being
  buried in a block of zeros.
