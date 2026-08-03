# ADR-0007: Outline extractors use regex, not AST parsing

- **Status:** Accepted
- **Date:** before 2026-05-31 (recorded retrospectively)

## Context

The `outline` tool summarises a file's symbols across TypeScript, Python, C#, SQL, Bash,
YAML, XML, and Markdown. Doing that properly means a parser per language — eight or more
dependencies, each with its own version surface, all bundled into a server that ships as a
single file.

## Decision

`src/tools/file/outline/` holds one regex-based extractor per language, dispatched by
`EXT_MAP` / `EXTRACTORS` on file extension, each returning an `ExtractResult` with
`symbols` (structured) and `outline` (formatted). No AST, no per-language dependency.

## Consequences

- Structural overview is good; exotic syntax is missed. That is the accepted trade.
- Outline is for navigation, not analysis — don't build a feature on it that needs
  guaranteed-complete symbol data.
- Adding a language is a self-contained extractor file, no dependency review.
- Reach for Serena/LSP when the task genuinely needs semantic accuracy.
