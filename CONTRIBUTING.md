# Contributing to bash-mcp

## Getting Started

```bash
git clone <repo-url>
cd bash-mcp
npm install
npm run dev
```

## Development Workflow

1. Create a branch from `main`
2. Make your changes
3. Run checks before pushing:

```bash
npm run lint        # Biome lint
npm run typecheck   # TypeScript type checking
npm test            # Vitest unit tests
```

4. Open a pull request against `main`

## Adding a New Tool

1. Decide if the tool fits an existing group (`src/tools/<group>/<group>.ts`) or needs a new directory
2. Define input and output schemas using Zod
3. Implement the handler using `exec()` or `execJson()` from `src/exec.ts`
4. Add a file-level JSDoc comment and doc comments on any helpers
5. Register the tool in `src/index.ts`
6. Add tests in a co-located `*.test.ts` file
7. Update the tool table in `README.md`

## Code Style

- **Formatting and linting**: Handled by [Biome](https://biomejs.dev/) — run `npm run lint:fix` to auto-fix
- **Comments**: Every file gets a module-level JSDoc comment. Exported functions and non-trivial helpers get JSDoc. Interfaces and types get field-level doc comments
- **Section dividers**: Use `// ── Section Name ──` to separate tool registrations within a file
- **Error handling**: Tools should always return a result (never throw). Use `isError: true` in the return for failures

## Project Structure

```
src/
  index.ts              # Server entry point
  exec.ts               # Command execution layer
  exec.test.ts          # Tests for exec
  response.ts           # MCP response helpers (ok, err)
  shell.ts              # Shell escaping utilities
  tools/
    <group>/
      <group>.ts        # Tool implementations
      <group>.test.ts   # Co-located tests
```

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
