/**
 * Tests for `--install-claude`.
 *
 * `installClaudeAssets` is driven through an in-memory filesystem (injected
 * deps) so every branch — fresh install, idempotent re-copy, drift in --check,
 * missing source — is exercised without touching the real ~/.claude or disk.
 * `formatInstallReport` is pure and tested directly.
 */

import { describe, expect, it } from "vitest";
import {
  type AssetSpec,
  formatInstallReport,
  installClaudeAssets,
} from "./install-claude.js";

const ASSETS: AssetSpec[] = [
  {
    label: "rules file",
    src: "/pkg/claude/rules/r.md",
    dest: "/home/.claude/rules/r.md",
    executable: false,
  },
  {
    label: "redirect hook",
    src: "/pkg/hooks/h.sh",
    dest: "/home/.claude/hooks/h.sh",
    executable: true,
  },
];

/** Build injectable deps over an in-memory file map. */
function fsDeps(files: Record<string, string>, check = false) {
  const chmods: Record<string, number> = {};
  const mkdirs: string[] = [];
  return {
    deps: {
      check,
      assets: ASSETS,
      fileExists: (p: string) => p in files,
      readFile: (p: string) => files[p] ?? "",
      copy: (src: string, dest: string) => {
        files[dest] = files[src];
      },
      mkdir: (dir: string) => {
        mkdirs.push(dir);
      },
      chmod: (p: string, mode: number) => {
        chmods[p] = mode;
      },
    },
    files,
    chmods,
    mkdirs,
  };
}

describe("installClaudeAssets", () => {
  it("creates both assets on a fresh machine and chmods the hook", () => {
    const { deps, files, chmods } = fsDeps({
      "/pkg/claude/rules/r.md": "RULES",
      "/pkg/hooks/h.sh": "HOOK",
    });
    const result = installClaudeAssets(deps);

    expect(result.exitCode).toBe(0);
    expect(result.results.map((r) => r.state)).toEqual(["create", "create"]);
    expect(files["/home/.claude/rules/r.md"]).toBe("RULES");
    expect(files["/home/.claude/hooks/h.sh"]).toBe("HOOK");
    expect(chmods["/home/.claude/hooks/h.sh"]).toBe(0o755);
  });

  it("reports 'update' when a dest exists with different content", () => {
    const { deps, files } = fsDeps({
      "/pkg/claude/rules/r.md": "NEW",
      "/pkg/hooks/h.sh": "HOOK",
      "/home/.claude/rules/r.md": "OLD",
      "/home/.claude/hooks/h.sh": "HOOK",
    });
    const result = installClaudeAssets(deps);

    expect(result.results[0]).toMatchObject({
      label: "rules file",
      state: "update",
    });
    expect(result.results[1]).toMatchObject({
      label: "redirect hook",
      state: "same",
    });
    expect(files["/home/.claude/rules/r.md"]).toBe("NEW");
  });

  it("--check reports drift (exit 1) without writing", () => {
    const { deps, files, mkdirs } = fsDeps(
      {
        "/pkg/claude/rules/r.md": "NEW",
        "/pkg/hooks/h.sh": "HOOK",
        "/home/.claude/rules/r.md": "OLD",
        "/home/.claude/hooks/h.sh": "HOOK",
      },
      true,
    );
    const result = installClaudeAssets(deps);

    expect(result.exitCode).toBe(1);
    expect(result.results.every((r) => !r.written)).toBe(true);
    expect(files["/home/.claude/rules/r.md"]).toBe("OLD"); // untouched
    expect(mkdirs).toEqual([]);
  });

  it("--check passes (exit 0) when everything matches", () => {
    const { deps } = fsDeps(
      {
        "/pkg/claude/rules/r.md": "SAME",
        "/pkg/hooks/h.sh": "HOOK",
        "/home/.claude/rules/r.md": "SAME",
        "/home/.claude/hooks/h.sh": "HOOK",
      },
      true,
    );
    expect(installClaudeAssets(deps).exitCode).toBe(1 - 1);
  });

  it("fails fast (exit 1) when a source asset is missing", () => {
    const { deps } = fsDeps({ "/pkg/hooks/h.sh": "HOOK" }); // rules file absent
    const result = installClaudeAssets(deps);

    expect(result.exitCode).toBe(1);
    expect(result.missingSource).toBe("/pkg/claude/rules/r.md");
    expect(result.results).toEqual([]); // halted before any write
  });
});

describe("formatInstallReport", () => {
  it("renders install lines and the settings.json hook snippet", () => {
    const report = formatInstallReport({
      exitCode: 0,
      results: [
        {
          label: "rules file",
          dest: "/home/.claude/rules/r.md",
          state: "create",
          written: true,
        },
        {
          label: "redirect hook",
          dest: "/home/.claude/hooks/h.sh",
          state: "update",
          written: true,
        },
      ],
    });
    expect(report).toContain("✓ created rules file");
    expect(report).toContain("✓ updated redirect hook");
    expect(report).toContain('"PreToolUse"');
    expect(report).toContain("/home/.claude/hooks/h.sh"); // in the hook command
  });

  it("renders a drift report in --check mode (nothing written)", () => {
    const report = formatInstallReport({
      exitCode: 1,
      results: [
        {
          label: "rules file",
          dest: "/home/.claude/rules/r.md",
          state: "update",
          written: false,
        },
        {
          label: "redirect hook",
          dest: "/home/.claude/hooks/h.sh",
          state: "same",
          written: false,
        },
      ],
    });
    expect(report).toContain("✗ rules file would update");
    expect(report).toContain("✓ redirect hook up to date");
    expect(report).toContain("--install-claude");
    expect(report).not.toContain("PreToolUse"); // no snippet in check mode
  });

  it("surfaces a missing source", () => {
    const report = formatInstallReport({
      exitCode: 1,
      results: [],
      missingSource: "/pkg/claude/rules/r.md",
    });
    expect(report).toContain("✗ missing source: /pkg/claude/rules/r.md");
  });
});
