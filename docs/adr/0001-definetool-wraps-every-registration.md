# ADR-0001: Every tool registers through `defineTool`, never `server.registerTool`

- **Status:** Accepted
- **Date:** 2026-05-31 (agent-ops-roadmap)

## Context

Cross-cutting concerns — timing, structured logging, uniform error catching, and (later)
doc generation — were needed identically by every tool. Adding them per handler meant the
same six lines copy-pasted across ~70 tools, with no way to guarantee a new tool got them.

## Decision

`src/tool.ts` exports `defineTool(server, name, config, handler)`, a decorator over
`server.registerTool`. It times the call, wraps the handler in try/catch/finally, emits
exactly one wide event, derives the outcome from `result.isError`, and converts a thrown
error into `err()`. Generics mirror `registerTool` so handler argument types still infer.

Tools call `defineTool`. `server.registerTool` is called in exactly one place — inside
`defineTool` itself.

## Consequences

- A tool cannot opt out of observability by forgetting to add it.
- `defineTool` also folds `equivalentCommands` into MCP `_meta` and pushes a `ToolRecord`
  into the registry, which is what makes [ADR-0002](0002-registry-generates-all-docs.md)
  possible — the decorator was the seam that made generated docs cheap.
- The config object accepts one non-MCP field (`equivalentCommands`), stripped before the
  SDK sees it.
- Tests that register tools must call `resetRegistry()` to avoid double-counting.
