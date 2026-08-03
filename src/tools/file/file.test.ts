/**
 * Tests for file tools (cat).
 *
 * Pure helpers (computeRange, applyLineNumbers) are tested directly; the disk
 * reader is exercised against a real temp file, and the git-ref reader against
 * this repo's own history. cat/head/sed/stat/wc/git are universally available.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyLineNumbers,
  computeRange,
  readFileContent,
  registerFileTools,
} from "./file.js";

/** Helper to create a server with file tools registered. */
function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerFileTools(server);
  return server;
}

describe("registerFileTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});

describe("computeRange", () => {
  it("defaults to the first 200 lines and truncates beyond that", () => {
    expect(computeRange({ totalLines: 500 })).toEqual({
      rangeStart: 1,
      rangeEnd: 200,
      truncated: true,
    });
  });

  it("returns the whole file when it fits under the default limit", () => {
    expect(computeRange({ totalLines: 50 })).toEqual({
      rangeStart: 1,
      rangeEnd: 50,
      truncated: false,
    });
  });

  it("treats maxLines:0 as unlimited", () => {
    expect(computeRange({ totalLines: 500, maxLines: 0 })).toEqual({
      rangeStart: 1,
      rangeEnd: 500,
      truncated: false,
    });
  });

  it("honours an explicit endLine without truncating", () => {
    expect(
      computeRange({ totalLines: 100, startLine: 10, endLine: 20 }),
    ).toEqual({ rangeStart: 10, rangeEnd: 20, truncated: false });
  });

  it("clamps an endLine past the end of the file", () => {
    expect(computeRange({ totalLines: 30, endLine: 999 })).toEqual({
      rangeStart: 1,
      rangeEnd: 30,
      truncated: false,
    });
  });

  it("clamps an open-ended read at startLine + maxLines", () => {
    expect(
      computeRange({ totalLines: 1000, startLine: 5, maxLines: 10 }),
    ).toEqual({ rangeStart: 5, rangeEnd: 14, truncated: true });
  });

  it("floors startLine at 1", () => {
    expect(computeRange({ totalLines: 10, startLine: 0 }).rangeStart).toBe(1);
  });

  it("handles an empty file", () => {
    expect(computeRange({ totalLines: 0 })).toEqual({
      rangeStart: 1,
      rangeEnd: 0,
      truncated: false,
    });
  });
});

describe("applyLineNumbers", () => {
  it("right-aligns numbers starting at rangeStart", () => {
    expect(applyLineNumbers("a\nb", 1)).toBe("     1\ta\n     2\tb");
  });

  it("starts numbering from a non-1 rangeStart", () => {
    expect(applyLineNumbers("x", 7)).toBe("     7\tx");
  });
});

describe("readFileContent (disk)", () => {
  let dir: string;
  let file: string;
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "bashmcp-file-"));
    file = join(dir, "sample.txt");
    writeFileSync(file, `${lines.join("\n")}\n`);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the whole file by default", async () => {
    const r = await readFileContent(file, {});
    expect(r.error).toBeUndefined();
    expect(r.content).toBe(lines.join("\n"));
    expect(r.totalLines).toBe(10);
    expect(r.range).toEqual([1, 10]);
    expect(r.truncated).toBe(false);
    expect(r.size).toBeGreaterThan(0);
  });

  it("limits and flags truncation with maxLines", async () => {
    const r = await readFileContent(file, { maxLines: 3 });
    expect(r.content).toBe("line 1\nline 2\nline 3");
    expect(r.range).toEqual([1, 3]);
    expect(r.truncated).toBe(true);
  });

  it("reads everything with maxLines:0", async () => {
    const r = await readFileContent(file, { maxLines: 0 });
    expect(r.content.split("\n")).toHaveLength(10);
    expect(r.truncated).toBe(false);
  });

  it("reads an explicit mid-file range via sed", async () => {
    const r = await readFileContent(file, { startLine: 3, endLine: 5 });
    expect(r.content).toBe("line 3\nline 4\nline 5");
    expect(r.range).toEqual([3, 5]);
    expect(r.truncated).toBe(false);
  });

  it("prepends line numbers when requested", async () => {
    const r = await readFileContent(file, { maxLines: 2, lineNumbers: true });
    expect(r.content).toBe("     1\tline 1\n     2\tline 2");
  });

  it("sets error (not throws) for a missing file", async () => {
    const r = await readFileContent(join(dir, "nope.txt"), {});
    expect(r.error).toBeTruthy();
    expect(r.content).toBe("");
  });
});

describe("readFileContent (git ref)", () => {
  // git-source.test.ts makes the exact claims about reading a ref, against a
  // temp repo. What is left to check here is the windowing readFromRef layers
  // on top — so read package.json, which is always committed.
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = execSync("git rev-parse --show-toplevel", { cwd: here })
    .toString()
    .trim();
  const committed = join(repoRoot, "package.json");

  it("windows a file read from HEAD", async () => {
    const r = await readFileContent(committed, { ref: "HEAD", maxLines: 1 });
    expect(r.error).toBeUndefined();
    expect(r.content).toBe("{");
    expect(r.range).toEqual([1, 1]);
    expect(r.truncated).toBe(true);
    expect(r.totalLines).toBeGreaterThan(1);
  });

  it("errors for a path outside any git repo", async () => {
    const r = await readFileContent("/nonexistent/abc.txt", { ref: "HEAD" });
    expect(r.error).toBeTruthy();
  });
});
