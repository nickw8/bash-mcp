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

If you have `BASH_MCP_MODE=off` exported in your shell, run the suite as
`env -u BASH_MCP_MODE npx vitest run` — otherwise `safety.test.ts` passes for the wrong
reason. Run `npm run typecheck` explicitly: the build does not typecheck.

4. Open a pull request against `main`

## Commits

Conventional Commits (`feat`/`fix`/`chore`/`docs`/`refactor`/`test`/…), one concern per
commit. No `Co-Authored-By` and no `Changelog:` trailers — this is a GitHub repo and
neither applies.

## Adding a New Tool

1. Decide if the tool fits an existing group (`src/tools/<group>/<group>.ts`) or needs a new directory
2. Define input and output schemas using Zod
3. Implement the handler using `exec()` or `execJson()` from `src/exec.ts`
4. Add a file-level JSDoc comment and doc comments on any helpers
5. Register the tool with `defineTool()` from `#tool` — not `server.registerTool` directly. A new group also gets an entry in the `GROUPS` table in `src/registry.ts` (not `src/index.ts`)
6. Add tests in a co-located `*.test.ts` file
7. Run `npm run docs:tools` — the tool tables in `README.md` and `docs/tools.md` are generated, so never edit them by hand

See [docs/adding-tools.md](docs/adding-tools.md) for the full guide.

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
  format.ts             # Multi-format list output (TSV, columnar, JSON)
  response.ts           # MCP response helpers (ok, okList, err)
  shell.ts              # Shell escaping utilities
  parsers/
    types.ts            # Shared interfaces: Diagnostic, TestResult, TestSuite
  tools/
    <group>/
      <group>.ts        # Tool implementations (barrel export)
      <group>.test.ts   # Co-located tests
      parsers/          # Output parsers (if the tool parses CLI output)
```

Shared parser types live in `src/parsers/types.ts` (importable as `#parsers`). Tool-specific parsers live under their tool group's `parsers/` directory and import shared types from there.

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
