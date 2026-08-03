/**
 * Tests for Git Source.
 *
 * These build a throwaway repo in a temp dir rather than reading bash-mcp
 * itself, so every assertion can be exact: a known commit hash, a known branch,
 * exact file content. Reading the live repo would force "either content or an
 * error, both valid" hedges, because an uncommitted file legitimately fails.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gitMeta, readAtRef, resolveRepo } from "./git-source.js";

const CONTENT = "one\ntwo\nthree\n";

let dir: string;
let file: string;
let head: string;
let branch: string;

beforeAll(() => {
  // realpath: macOS tmpdir is a symlink (/var → /private/var) and rev-parse
  // reports the resolved form, which relPath is sliced against.
  dir = execFileSync("realpath", [mkdtempSync(join(tmpdir(), "git-source-"))])
    .toString()
    .trim();
  file = join(dir, "a.txt");
  writeFileSync(file, CONTENT);

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    })
      .toString()
      .trim();

  git("init", "-q");
  git("add", "a.txt");
  git("commit", "-q", "-m", "add a.txt");
  head = git("rev-parse", "HEAD");
  branch = git("rev-parse", "--abbrev-ref", "HEAD");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("resolveRepo", () => {
  it("returns the repo root and the path relative to it", async () => {
    expect(await resolveRepo(file)).toEqual({ root: dir, relPath: "a.txt" });
  });

  it("returns null for a path outside any git repo", async () => {
    expect(await resolveRepo("/nonexistent/abc.txt")).toBeNull();
  });
});

describe("readAtRef", () => {
  it("reads the committed content at a ref", async () => {
    const repo = await resolveRepo(file);
    expect(repo).not.toBeNull();
    const r = await readAtRef(repo as NonNullable<typeof repo>, "HEAD");
    expect(r.error).toBeNull();
    expect(r.content).toBe(CONTENT);
  });

  it("reads the committed content, not the working tree", async () => {
    writeFileSync(file, "dirty\n");
    const repo = await resolveRepo(file);
    const r = await readAtRef(repo as NonNullable<typeof repo>, "HEAD");
    expect(r.content).toBe(CONTENT);
    writeFileSync(file, CONTENT);
  });

  it("reports a bad ref as an error rather than throwing", async () => {
    const repo = await resolveRepo(file);
    const r = await readAtRef(repo as NonNullable<typeof repo>, "no-such-ref");
    expect(r.content).toBeNull();
    expect(r.error).toBeTruthy();
  });
});

describe("gitMeta", () => {
  it("reports the branch and the commit that last touched the file", async () => {
    const repo = await resolveRepo(file);
    expect(await gitMeta(repo, "HEAD")).toEqual({ branch, commit: head });
  });

  it("returns nulls for a file outside any git repo", async () => {
    expect(await gitMeta(null)).toEqual({ branch: null, commit: null });
  });
});
