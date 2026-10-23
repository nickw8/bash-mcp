# ADR-0018: The text block format is fixed per tool

- **Status:** Accepted
- **Date:** 2026-10-23 (v5)
- **Supersedes in part:** [ADR-0006](0006-compact-text-block-via-oklist.md) (the
  caller-chosen `format` and `fields`)

## Context

ADR-0006 let a list tool's caller pick the text block's rendering (`format`) and
columns (`fields`). ADR-0009 and ADR-0012 then made `structuredContent` what the agent
reads and the text block a summary. A `structuredContent` client discards the text
block, so the two arguments saved it nothing. They still cost it: 19 tools advertised
them, 1,084 of the 12,848 model-facing schema tokens in `tools/list`.

## Decision

- `format` and `fields` are removed from every `inputSchema`, including
  `diagnosticInputSchema`. Each tool renders its text block in the format that was
  its default (`bare`, `tsv` or `grouped`; see output-conventions.md).
- `defineTool` drops a `format` or `fields` argument a tool does not declare before
  validation, until 6.0.0, so a v4 caller does not get `invalid_input`. Every other
  undeclared argument is still refused (ADR-0014). The drop happens in a `ZodObject`
  subclass, not `z.preprocess`, because the SDK advertises a non-object schema as `{}`.
- A tool that declares its own `format` (none today) receives it as usual.

## Consequences

- `all` costs 11,764 model tokens (−8.4%) and 23,425 wire tokens.
- A text-only client can no longer ask for another rendering or a column subset.
- `okList` takes no `fields` option, and `projectRows` is gone.
- 6.0.0 removes the drop, and a stray `format`/`fields` is then refused like any other
  undeclared key.
