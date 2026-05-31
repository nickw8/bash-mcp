/**
 * Tests for the shared git output parsers.
 */

import { describe, expect, it } from "vitest";
import {
  COMMIT_SEP,
  parseBranchStatus,
  parseCommits,
  parseNameStatus,
  parseShortstat,
} from "./parse.js";

describe("parseCommits", () => {
  it("parses formatted log lines (subject may contain the separator-safe text)", () => {
    const line = (h: string, s: string) =>
      ["aaa", h, "Ada", "2024-01-01T00:00:00Z", s].join(COMMIT_SEP);
    const out = parseCommits(
      `${line("a1", "feat: x")}\n${line("b2", "fix: y")}`,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      hash: "aaa",
      shortHash: "a1",
      author: "Ada",
      date: "2024-01-01T00:00:00Z",
      message: "feat: x",
    });
  });

  it("handles empty input", () => {
    expect(parseCommits("")).toEqual([]);
  });
});

describe("parseShortstat", () => {
  it("parses files/insertions/deletions", () => {
    expect(
      parseShortstat(" 3 files changed, 12 insertions(+), 4 deletions(-)"),
    ).toEqual({ files: 3, insertions: 12, deletions: 4 });
  });

  it("handles insertions-only and singular forms", () => {
    expect(parseShortstat(" 1 file changed, 1 insertion(+)")).toEqual({
      files: 1,
      insertions: 1,
      deletions: 0,
    });
  });

  it("returns zeros for empty stat", () => {
    expect(parseShortstat("")).toEqual({
      files: 0,
      insertions: 0,
      deletions: 0,
    });
  });
});

describe("parseNameStatus", () => {
  it("parses status/file rows", () => {
    const out = parseNameStatus("M\tsrc/a.ts\nA\tsrc/b.ts\nD\tsrc/c.ts");
    expect(out).toEqual([
      { status: "M", file: "src/a.ts" },
      { status: "A", file: "src/b.ts" },
      { status: "D", file: "src/c.ts" },
    ]);
  });
});

describe("parseBranchStatus", () => {
  it("parses branch, ahead/behind, and change counts from porcelain v2", () => {
    const out = parseBranchStatus(
      [
        "# branch.oid abc",
        "# branch.head feature/x",
        "# branch.upstream origin/feature/x",
        "# branch.ab +2 -1",
        "1 M. N... 100644 100644 100644 aaa bbb src/staged.ts",
        "1 .M N... 100644 100644 100644 aaa bbb src/unstaged.ts",
        "? src/new.ts",
      ].join("\n"),
    );
    expect(out.branch).toBe("feature/x");
    expect(out.ahead).toBe(2);
    expect(out.behind).toBe(1);
    expect(out.staged).toBe(1);
    expect(out.unstaged).toBe(1);
    expect(out.untracked).toBe(1);
    expect(out.clean).toBe(false);
  });

  it("reports a clean tree", () => {
    const out = parseBranchStatus("# branch.head main\n# branch.ab +0 -0");
    expect(out.clean).toBe(true);
    expect(out.branch).toBe("main");
  });
});
