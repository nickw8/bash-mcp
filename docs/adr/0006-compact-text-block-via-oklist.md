# ADR-0006: Flat lists return a compact text block; `structuredContent` stays complete

- **Status:** Superseded by [ADR-0009](0009-structuredcontent-is-what-the-agent-reads.md)
- **Date:** 2026-05-31

> **Superseded 2026-08-03.** The premise below — that the text block is what the model is
> charged for — is false for clients that render `structuredContent` (Claude Code does).
> The mechanics in this ADR still stand and are still in the code; their *token rationale*
> does not. See [ADR-0009](0009-structuredcontent-is-what-the-agent-reads.md).

## Context

Only the text block of a response is token-counted by the model; `structuredContent` is
the typed payload. Returning `ok()` for a list tool puts the whole JSON in the text block,
which is the most expensive possible encoding of a table — and the entire point of this
server is to cost fewer tokens than the raw CLI.

## Decision

Flat-list tools return via `okList(structuredContent, rows, meta, format)`, not `ok()`.
`structuredContent` stays schema-complete; `rows` and `meta` drive a compact text block.

Defaults by shape: `bare` (headerless, single-column — `tree`, `glob`, `tf_state_list`),
`tsv` (multi-column — `ls`, `du`, `git_log`, `git_branches`, `kube_contexts`), `grouped`
(ripgrep-style, header once per group — `rg` and the diagnostic tools).

`rows` are curated: derived and redundant columns are dropped from the text without
changing `outputSchema`. Variable-size lists spread `...budgetSchema` and call
`applyBudget`, emitting `total`/`truncated` only when a budget parameter was passed so the
no-parameter shape is unchanged. Lint/typecheck/build tools go through
`diagnosticsResponse` rather than `ok()`.

## Consequences

- The text block and `structuredContent` deliberately differ. Never assume they match.
- Curating `rows` is a text-only change and does not break a consumer reading
  `structuredContent`.
- Output size is guarded by two CI tests — `src/format.budget.test.ts` on the formatter and
  `src/benchmark.fixtures.test.ts` on recorded per-tool budgets — so a well-meant change to
  a text block cannot silently make a tool more expensive than the CLI it replaces.
- Some tools measure negative on small fixtures (fixed overhead that amortises on real
  inputs); they are kept and documented rather than tuned for the benchmark.
