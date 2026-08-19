# ADR-0013: defineTool owns required-argument validation, not Zod

- **Status:** Accepted
- **Date:** 2026-08-19 (payload-hardening)
- **Relates to:** [ADR-0001](0001-definetool-wraps-every-registration.md),
  [ADR-0011](0011-the-outputschema-defines-the-error-payload.md)

## Context

A field declared required in a tool's Zod `inputSchema` is enforced by the SDK, *outside*
the `defineTool` wrapper. When it is missing the SDK rejects the call with

```
MCP error -32602: MCP error -32602: Invalid arguments for tool rg: [ … ]
```

That is a JSON-RPC protocol error, not a tool result. It carries no `structuredContent`, no
`error.kind`, no `suggestion`, and no wide event — the call never reaches the handler, so
nothing in this codebase sees it. To an agent it is indistinguishable from a transport
failure, which is one of the ways "the tool call was malformed" gets reported. And the
missing argument is often one the agent could have supplied immediately: `rg` without
`pattern`, `npm_lint` without `cwd`.

Every other failure in this server is a readable result (ADR-0005). Required arguments were
the one class that escaped that.

## Decision

A tool that cannot run without an argument declares the field **`.optional()`** in
`inputSchema` and names it in a new **`required: [...]`** array on the tool config.
`defineTool` checks it before invoking the handler and returns a normal error result:

- `kind: "invalid_input"`, message `"<tool>: missing required argument <name>"`,
- `suggestion: "Call <tool> with <name>: <value>."`,
- the `zeroOf(outputSchema)` payload underneath, per ADR-0011,
- and a wide event with `outcome: "error"`, `errorKind: "invalid_input"` — so a missing
  argument is now observable, which it was not before.

`undefined` and `null` count as absent. `""`, `0`, and `false` do not: an empty string is an
answer the caller gave, and second-guessing it would break `rg` searching for the empty
pattern as surely as the SDK broke the missing one.

`required` never reaches `registerTool` — `defineTool` strips it alongside
`equivalentCommands` — but it *is* captured in the tool registry, so `docs/tools.md` marks
those arguments required even though the schema calls them optional.

A Zod-optional field with a `.default()` keeps its default and stays out of `required`:
`find_files` without `path` searches `"."`, which is a working call, not a missing argument.

## Considered options

- **Keep Zod-required and let the SDK reject.** Rejected: the caller gets a protocol error
  the server cannot shape, log, or explain.
- **Validate inside each handler.** Rejected: the same four lines in ~70 handlers, and one
  forgotten copy is a silent regression. This is exactly the cross-cutting concern the
  wrapper exists for (ADR-0001).

## Consequences

- The schema no longer states the whole contract — `required` does. A reader of
  `inputSchema` alone sees everything as optional. `docs/tools.md` and this ADR are where
  the truth lives; the doc-gen carries it through.
- Migration is per-tool: a field left Zod-required still yields `-32602`. `run.command` is
  the known holdout, tracked as a follow-up.
- `src/tool.test.ts` guards the contract against the real registered tools: a call missing
  the argument must come back `isError` with `kind: "invalid_input"`, never throw.
