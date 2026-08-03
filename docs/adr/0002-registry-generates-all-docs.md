# ADR-0002: The registry generates every tool list; none are hand-maintained

- **Status:** Accepted
- **Date:** 2026-05-31 (tool-reference-and-transparency + capstone)

## Context

The same tool inventory was written by hand in several places: the README tool tables, the
README "Which tool?" table, the agent rules file, and prose in the entry doc. Every new
tool meant editing all of them, and they drifted — a table would list a tool that had been
renamed, or omit one added a week earlier. Drift in an agent-facing list is worse than no
list: it sends the agent at a tool that doesn't exist.

## Decision

One table, `GROUPS` in `src/registry.ts`, pairs each group's `register*Tools` with its
category. `registerAll` iterates it (so `src/index.ts` never gains per-group calls), and
`buildRegistry()` replays the same registrations against a no-op server to collect
`ToolRecord`s.

Pure renderers in `src/docs/render.ts` turn that into every published list:
`renderToolDocs` → `docs/tools.md`, `renderToolsSection` → the README
`<!-- GENERATED: tools -->` region, `renderWhichToolTable` → the
`<!-- GENERATED: which-tool -->` region from guidance `INTENTS`, `renderAgentRules` →
`claude/rules/bash-mcp-tools.md`. `npm run docs:tools` writes them; `-- --check` fails when
stale; `src/docs/render.test.ts` guards it in CI.

Being the registry and publishing it are separate modules. `src/registry.ts` is on the
server's boot path and holds only `GROUPS`, `registerAll` and `buildRegistry`; the
renderers are reached solely by the generator and its guard. The dependency runs one way —
renderers read a `ToolRecord[]`, the registry knows nothing about markdown.

A tool carrying `equivalentCommands` must also appear in the redirect hook's `RULES` (or
be listed `EXEMPT`); a parity test enforces it.

## Consequences

- Generated regions are never hand-edited — an edit is overwritten and fails the guard.
- Adding a tool means touching the source and running one command; forgetting the command
  is caught by CI, not by a reviewer's memory.
- README blurbs are the first sentence of each tool's description, so that sentence has to
  stand alone.
- A new group is added to `GROUPS`, never to `src/index.ts`.
- The generator runs under tsx so it can import the TypeScript sources directly, and the
  Zod→type printer is a small custom one rather than a `zod-to-json-schema` dependency.
