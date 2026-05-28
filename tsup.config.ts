/**
 * tsup bundler configuration for bash-mcp.
 *
 * Produces a single self-contained dist/index.js suitable for `npm install -g`
 * or direct execution. Zod is inlined (small, pure JS) while the MCP SDK stays
 * external — its subpath exports (`@modelcontextprotocol/sdk/server/mcp.js`)
 * don't survive bundling reliably.
 *
 * The banner injects a Node shebang so the bin entry is executable without a
 * separate post-processing step.
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: false,
  splitting: false,
  sourcemap: false,
  noExternal: ["zod"],
  external: ["@modelcontextprotocol/sdk", /^@modelcontextprotocol\/sdk\//],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
