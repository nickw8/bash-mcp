#!/usr/bin/env node
/**
 * install-claude-assets.mjs — clone-time entry for `npm run claude:install`.
 *
 * Thin wrapper over src/install-claude.ts (the same module that backs the
 * `bash-mcp --install-claude` subcommand for npm-installed consumers). Run via
 * tsx so the .ts import resolves; the core logic and path resolution live in
 * src so both entry points stay in lockstep.
 *
 *   npm run claude:install          # copy into ~/.claude (overwrites)
 *   npm run claude:check            # report drift, write nothing
 */
import {
  formatInstallReport,
  installClaudeAssets,
} from "../src/install-claude.js";

const result = installClaudeAssets({ check: process.argv.includes("--check") });
console.log(formatInstallReport(result));
process.exit(result.exitCode);
