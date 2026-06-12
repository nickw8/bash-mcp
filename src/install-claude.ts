/**
 * bash-mcp --install-claude — copy the agent-facing assets into ~/.claude.
 *
 * Two surfaces steer agents toward the structured tools:
 *   - claude/rules/bash-mcp-tools.md → ~/.claude/rules/bash-mcp-tools.md
 *       (auto-loaded into every Claude Code session; the tool inventory)
 *   - hooks/bash-mcp-redirect.sh     → ~/.claude/hooks/bash-mcp-redirect.sh
 *       (PreToolUse(Bash) redirect; made executable)
 *
 * Both source files are committed/generated in the package, so installing is a
 * plain copy. This works for an npm-installed consumer (`npx @nickw8/bash-mcp
 * --install-claude`) because `claude/` and `hooks/` ship in the published
 * tarball; the same module backs the clone-time `npm run claude:install`.
 *
 * Design mirrors doctor.ts (`/arch:node`): `installClaudeAssets` takes injectable
 * deps and returns a structured result + exit code with no `process.exit`/real IO
 * required, so tests drive every branch; `formatInstallReport` is pure. The edge
 * (index.ts / the script wrapper) prints and exits.
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

/** One asset to install: where it comes from, where it goes, and its mode. */
export interface AssetSpec {
  label: string;
  src: string;
  dest: string;
  executable: boolean;
}

export type AssetState = "create" | "update" | "same";

export interface AssetResult {
  label: string;
  dest: string;
  state: AssetState;
  /** True when the file was actually written (false in --check mode). */
  written: boolean;
}

export interface InstallResult {
  results: AssetResult[];
  /** Missing source → 1; --check with drift → 1; otherwise 0. */
  exitCode: number;
  /** Set when a source file was missing (fatal); halts before any write. */
  missingSource?: string;
}

/** Injectable dependencies — defaults read the real filesystem and ~/.claude. */
export interface InstallDeps {
  check?: boolean;
  repoRoot?: string;
  claudeDir?: string;
  assets?: AssetSpec[];
  fileExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
  copy?: (src: string, dest: string) => void;
  mkdir?: (dir: string) => void;
  chmod?: (path: string, mode: number) => void;
}

/** Resolve the package root from this module (works in bundle or src). */
function defaultRepoRoot(): string {
  // In the built bundle this file is folded into dist/index.js; under tsx/vitest
  // it's src/install-claude.ts. In both cases the package root is one dir up
  // from the file's directory (dist/ or src/).
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/** The two assets, anchored at a package root and a target ~/.claude dir. */
function defaultAssets(repoRoot: string, claudeDir: string): AssetSpec[] {
  return [
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
}

/** Compare src/dest contents → which action a copy would take. */
function diffState(
  src: string,
  dest: string,
  fileExists: (p: string) => boolean,
  readFile: (p: string) => string,
): AssetState {
  if (!fileExists(dest)) return "create";
  return readFile(src) === readFile(dest) ? "same" : "update";
}

/** Copy each asset into ~/.claude (or, with `check`, report drift only). */
export function installClaudeAssets(deps: InstallDeps = {}): InstallResult {
  const {
    check = false,
    repoRoot = defaultRepoRoot(),
    claudeDir = join(homedir(), ".claude"),
    fileExists = existsSync,
    readFile = (p) => readFileSync(p, "utf8"),
    copy = copyFileSync,
    mkdir = (dir) => {
      mkdirSync(dir, { recursive: true });
    },
    chmod = chmodSync,
    assets = defaultAssets(repoRoot, claudeDir),
  } = deps;

  const results: AssetResult[] = [];

  for (const asset of assets) {
    if (!fileExists(asset.src)) {
      return { results, exitCode: 1, missingSource: asset.src };
    }

    const state = diffState(asset.src, asset.dest, fileExists, readFile);

    if (!check) {
      mkdir(dirname(asset.dest));
      copy(asset.src, asset.dest);
      if (asset.executable) chmod(asset.dest, 0o755);
    }

    results.push({
      label: asset.label,
      dest: asset.dest,
      state,
      written: !check,
    });
  }

  const drift = check && results.some((r) => r.state !== "same");
  return { results, exitCode: drift ? 1 : 0 };
}

/** The PreToolUse(Bash) hook block to paste into ~/.claude/settings.json. */
function hookSnippet(hookDest: string): string {
  return JSON.stringify(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: `bash "${hookDest}"`,
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
  );
}

/** Render the result as printable text (pure — no IO). */
export function formatInstallReport(result: InstallResult): string {
  if (result.missingSource) {
    return [
      `✗ missing source: ${result.missingSource}`,
      "  Run `npm run docs:tools` (rules file) or reinstall the package.",
    ].join("\n");
  }

  // --check: results were never written; report drift and stop.
  if (result.results.every((r) => !r.written)) {
    const lines = result.results.map((r) =>
      r.state === "same"
        ? `✓ ${r.label} up to date (${r.dest})`
        : `✗ ${r.label} would ${r.state}: ${r.dest}`,
    );
    lines.push(
      "",
      result.exitCode === 0
        ? "All bash-mcp Claude assets are up to date."
        : "Assets are out of date in ~/.claude. Run `npx @nickw8/bash-mcp --install-claude`.",
    );
    return lines.join("\n");
  }

  // install: report each write, then print the settings.json hook snippet.
  const lines = result.results.map(
    (r) =>
      `✓ ${r.state === "create" ? "created" : "updated"} ${r.label}: ${r.dest}`,
  );
  const hook = result.results.find((r) => r.label === "redirect hook");
  lines.push(
    "",
    "Done. To enable the redirect hook globally, add this to ~/.claude/settings.json:",
    "",
    hook ? hookSnippet(hook.dest) : "(redirect hook not installed)",
    "",
    "The rules file needs no settings — Claude Code auto-loads ~/.claude/rules/*.md.",
  );
  return lines.join("\n");
}
