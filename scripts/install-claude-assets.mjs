#!/usr/bin/env node
/**
 * install-claude-assets.mjs — copy bash-mcp's agent-facing assets into ~/.claude.
 *
 * Two surfaces steer agents toward the structured tools:
 *   - claude/rules/bash-mcp-tools.md → ~/.claude/rules/bash-mcp-tools.md
 *       (auto-loaded into every Claude Code session; the tool inventory)
 *   - hooks/bash-mcp-redirect.sh     → ~/.claude/hooks/bash-mcp-redirect.sh
 *       (PreToolUse(Bash) redirect; made executable)
 *
 * Both source files are generated/committed in this repo, so installing is a
 * plain copy. Re-run after `npm run docs:tools` to refresh the rules file.
 *
 *   npm run claude:install            # copy into ~/.claude (overwrites)
 *   node scripts/install-claude-assets.mjs --check   # report drift, write nothing
 *
 * After a first install, add the PreToolUse hook printed at the end to
 * ~/.claude/settings.json (global) — it is not edited automatically.
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const claudeDir = join(homedir(), ".claude");

/** One asset to install: where it comes from, where it goes, and its mode. */
const ASSETS = [
  {
    label: "rules file",
    src: join(repoRoot, "claude", "rules", "bash-mcp-tools.md"),
    dest: join(claudeDir, "rules", "bash-mcp-tools.md"),
    executable: false,
  },
  {
    label: "redirect hook",
    src: join(repoRoot, "hooks", "bash-mcp-redirect.sh"),
    dest: join(claudeDir, "hooks", "bash-mcp-redirect.sh"),
    executable: true,
  },
];

const check = process.argv.includes("--check");

/** Compare src/dest contents → "create" | "update" | "same". */
function status(src, dest) {
  if (!existsSync(dest)) return "create";
  return readFileSync(src, "utf8") === readFileSync(dest, "utf8")
    ? "same"
    : "update";
}

let drift = false;

for (const { label, src, dest, executable } of ASSETS) {
  if (!existsSync(src)) {
    console.error(
      `✗ missing source: ${src}\n  Run \`npm run docs:tools\` (rules file) / check the repo.`,
    );
    process.exit(1);
  }

  const state = status(src, dest);

  if (check) {
    if (state === "same") {
      console.log(`✓ ${label} up to date (${dest})`);
    } else {
      console.error(`✗ ${label} would ${state}: ${dest}`);
      drift = true;
    }
    continue;
  }

  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  if (executable) chmodSync(dest, 0o755);
  const verb = state === "create" ? "created" : "updated";
  console.log(`✓ ${verb} ${label}: ${dest}`);
}

if (check) {
  if (drift) {
    console.error(
      "\nAssets are out of date in ~/.claude. Run `npm run claude:install`.",
    );
    process.exit(1);
  }
  console.log("\nAll bash-mcp Claude assets are up to date.");
  process.exit(0);
}

const hookPath = ASSETS[1].dest;
console.log(
  [
    "",
    "Done. To enable the redirect hook globally, add this to ~/.claude/settings.json:",
    "",
    JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: `bash "${hookPath}"`,
                  timeout: 5,
                  statusMessage: "Checking for bash-mcp alternatives...",
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
    "",
    "The rules file needs no settings — Claude Code auto-loads ~/.claude/rules/*.md.",
  ].join("\n"),
);
