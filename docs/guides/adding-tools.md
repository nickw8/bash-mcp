# Adding or Editing a Tool

Read when writing a new tool, changing an existing one, or adding a tool group.

## Steps

1. Add to an existing category or create a new category directory under `src/tools/<cat>/`
2. Register with `defineTool(server, name, config, handler)` from `#tool` — NOT `server.registerTool` directly (defineTool adds wide-event logging + uniform error catching, folds `equivalentCommands` into MCP `_meta`, and records the tool in the registry)
3. Define `inputSchema` and `outputSchema` with Zod
4. Call `exec()` or `execJson()` from `#exec`, return `ok()` / `okList()` / `err()` from `#response`
5. New category only: add it to the `GROUPS` table in `src/registry.ts` (NOT `src/index.ts` directly), giving it a README category
6. Add a co-located test file (`<cat>.test.ts`)
7. Run `npm run docs:tools` to regenerate the docs, then `npm run lint:fix`

## Config object

- Read-only tools carry `annotations: { readOnlyHint: true }`. Excluded as mutating or arbitrary-exec: `run`, `batch`, `npm_lint` / `python_lint` (they have `--fix`), `npm_test` / `python_test` / `dotnet_test` / `dotnet_build`
- Add `equivalentCommands: ["..."]` for the raw CLI the tool approximates — set this by default for any tool wrapping a real CLI; leave it unset only when the tool maps to no single CLI invocation (e.g. batch, list_guidance, outline, tf_modules_summary, tf_backend_info)
- An argument the tool cannot run without goes in `required: ["pattern"]` on the config, and its Zod field stays **`.optional()`**. A Zod-required field is rejected by the SDK as `MCP error -32602` before the wrapper runs — no payload, no error kind, no wide event; naming it in `required` turns the same omission into a readable `invalid_input` result ([ADR-0013](../adr/0013-definetool-owns-required-arg-validation.md)). A field with a working `.default()` is not required (`find_files` without `path` searches `"."`)
- The README table blurbs are the first sentence of each tool's description — keep that sentence self-contained
- All tools return: `{ content: [{ type: "text", text }], structuredContent: {...}, isError?: true }`. Tools always return a result, never throw — a command that ran and failed is `ok(...)`, only an unrunnable one is `err(...)` ([ADR-0005](../adr/0005-wrapped-failure-is-a-result.md))
- Which response helper to use, and how to shape the text block: [output-conventions.md](output-conventions.md)

## Generated docs — never hand-edit

`npm run docs:tools` regenerates:

- `docs/tools.md`
- the README generated regions (`<!-- BEGIN/END GENERATED: tools|which-tool -->` — grouped tool tables + the "Which tool?" intent table)
- the agent-facing rules file `claude/rules/bash-mcp-tools.md` (via `renderAgentRules` — one row per registry category; `CATEGORY_AVOID` in `src/docs/render.ts` holds the curated "instead of" cell and a missing entry throws)

Run it after touching a tool's title/description, `equivalentCommands`, the `GROUPS`
table, or guidance `INTENTS`, or the registry guard test fails. `npm run docs:tools -- --check`
fails if stale.

## Wiring a new group — update these together

A new tool group touches several allowlists, each with its own guard test. Miss one and
the failure surfaces far from the change:

| File | What to add |
|---|---|
| `src/registry.ts` | `GROUPS` entry |
| `src/docs/render.ts` | new category only: a `CATEGORY_ORDER` and a `CATEGORY_AVOID` entry |
| `src/tools/env/env.ts` + `env.test.ts` | a `PROBES` entry for the new CLI, and its name in the test's list |
| `src/tools/guidance/guidance.ts` + `guidance.test.ts` | an `INTENTS` entry, and the tool name in `KNOWN_TOOLS` |
| `hooks/bash-mcp-redirect.sh` + its test | a `RULES` entry (or an `EXEMPT` reason) |
| `src/index.ts` | the server `instructions` string |
| — | then `npm run docs:tools` (guarded by `registry.test.ts` and `docs:tools --check`) |

## Redirect hook parity

A new tool with `equivalentCommands` must also get a `RULES` entry in
`hooks/bash-mcp-redirect.sh` (or an `EXEMPT` reason in `hooks/bash-mcp-redirect.test.ts`)
— the registry↔hook parity test enforces it.

`scripts/install-claude-assets.mjs` (`npm run claude:install`, `npm run claude:check`)
copies the generated rules file + hook into `~/.claude/`.

## File Organization

**Small categories** (1-2 tools): single file `<cat>.ts` with a `register<Cat>Tools(server)` export.

**Large categories** (3+ tools): split each tool into its own file with a barrel re-export:
```
src/tools/<cat>/
  <cat>.ts          — barrel: imports sub-registrations, exports register<Cat>Tools()
  <tool1>.ts        — single tool registration
  <tool2>.ts        — single tool registration
  <cat>.test.ts     — tests
```

**Shared parsing logic**: use a `parsers/` subdirectory (like `npm/parsers/` or `dotnet/parsers/`):
```
src/tools/<cat>/
  parsers/
    <format>.ts     — parser for a specific output format (imports types from #parsers)
```

Shared parser interfaces (`Diagnostic`, `TestResult`, `TestSuite`, `BudgetParams`) live in
`src/parsers/types.ts`, importable as `#parsers`. New parser types that could be reused
across tool groups should be added there, not in tool-specific `parsers/` directories.

Shared Zod schemas live in `src/parsers/schemas.ts` — use `diagnosticSchema` /
`testResultSchema` in `outputSchema`; spread `budgetSchema` and call `applyBudget` for
variable-size lists.

## Conventions

- Each tool file exports a single `register<ToolName>Tool(server)` function
- Barrel files call all sub-registrations so the `GROUPS` entry stays unchanged
- Use `#parsers` for shared types, tool-local `parsers/` for format-specific logic
- Timeouts use the `TIMEOUT` constants from `src/exec.ts` (DEFAULT, INFRA, BUILD, TYPECHECK) — see [configuration.md](../architecture/configuration.md)
- Co-located tests: `<name>.test.ts` next to `<name>.ts`; pure parsers extracted to `parse.ts` / `diagnose.ts` with fixture-driven tests reading from `fixtures/`
- Build with tsup (single-file bundle with shebang), dev with tsx (fast reload)
