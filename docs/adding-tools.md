# Adding a New Tool

1. Add to existing category file (`src/tools/<cat>/<cat>.ts`) or create new category directory
2. Use `server.registerTool(name, { title, description, inputSchema, outputSchema }, handler)`
3. Call `exec()` or `execJson()` from `#exec`, return `ok()` or `err()` from `#response`
4. Register in `src/index.ts` if new category
5. Add co-located test file (`<cat>.test.ts`)
