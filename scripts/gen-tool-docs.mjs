#!/usr/bin/env node
/**
 * gen-tool-docs.mjs — generate the registry-derived docs from the registered tools.
 *
 * Single source of truth is the tool registry: defineTool records each tool, and
 * src/registry.ts `buildRegistry()` runs every group against a no-op server to
 * collect them, and src/docs/render.ts renders it. Two artifacts are rendered deterministically (re-running is a
 * no-op), mirroring scripts/token-benchmark.mjs (generator) + its fixtures guard:
 *   - docs/tools.md      — full reference (`renderToolDocs`)
 *   - README.md regions  — "Which tool?" table + grouped "## Tools" (`renderReadme`,
 *                          driven by the registry + the guidance INTENTS)
 *   - claude/rules/bash-mcp-tools.md — agent-facing rules file (`renderAgentRules`),
 *                          installed into ~/.claude/rules by scripts/install-claude-assets.mjs
 *
 *   npm run docs:tools           # rewrite docs/tools.md + README regions + rules file
 *   node scripts/gen-tool-docs.mjs --check   # fail if any is stale (CI)
 *
 * Run under tsx (see package.json) so the TypeScript registry imports resolve.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderAgentRules,
  renderReadme,
  renderToolDocs,
} from "../src/docs/render.js";
import { buildRegistry } from "../src/registry.js";
import { INTENTS } from "../src/tools/guidance/guidance.js";

const here = dirname(fileURLToPath(import.meta.url));
const docPath = join(here, "..", "docs", "tools.md");
const readmePath = join(here, "..", "README.md");
const rulesPath = join(here, "..", "claude", "rules", "bash-mcp-tools.md");

const tools = buildRegistry();
const md = renderToolDocs(tools);
const readme = renderReadme(readFileSync(readmePath, "utf8"), tools, INTENTS);
const rules = renderAgentRules(tools);

const check = process.argv.includes("--check");
let stale = false;

function reconcile(path, expected, label) {
  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {
    // missing file → treat as stale
  }
  if (current === expected) {
    if (check) console.log(`${label} is up to date.`);
    return;
  }
  if (check) {
    console.error(
      `${label} is out of date. Regenerate with \`npm run docs:tools\`.`,
    );
    stale = true;
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, expected);
    console.log(`wrote ${path}`);
  }
}

reconcile(docPath, md, "docs/tools.md");
reconcile(readmePath, readme, "README.md generated regions");
reconcile(rulesPath, rules, "claude/rules/bash-mcp-tools.md");

if (check && stale) process.exit(1);
