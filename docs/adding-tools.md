# Adding a New Tool

1. Add to existing category or create new category directory under `src/tools/<cat>/`
2. Use `server.registerTool(name, { title, description, inputSchema, outputSchema }, handler)`
3. Call `exec()` or `execJson()` from `#exec`, return `ok()` or `err()` from `#response`
4. Register in `src/index.ts` if new category
5. Add co-located test file (`<cat>.test.ts`)

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

Shared parser interfaces (`Diagnostic`, `TestResult`, `TestSuite`) live in `src/parsers/types.ts`, importable as `#parsers`. New parser types that could be reused across tool groups should be added there, not in tool-specific `parsers/` directories.

## Conventions

- Each tool file exports a single `register<ToolName>Tool(server)` function
- Barrel files call all sub-registrations so `index.ts` imports stay unchanged
- Use `#parsers` for shared types, tool-local `parsers/` for format-specific logic
- Run `npx biome check --fix .` before committing
