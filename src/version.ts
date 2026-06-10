/**
 * Single source of the package version inside `src/`.
 *
 * Both the MCP server identity (src/index.ts) and the wide-event logger's
 * static context (src/logger.ts) read this constant, so the version lives in
 * one place rather than being copy-pasted across modules. `version.test.ts`
 * asserts it — and server.json — stay in lockstep with package.json, using the
 * same drift-guard pattern as docs/tools.md and the tool registry.
 *
 * tsup inlines this at build time; under tsx/vitest it resolves to source.
 */
export const VERSION = "1.1.0";
