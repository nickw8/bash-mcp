import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFail, execOk } from "../test-support.js";

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#exec")>();
  return { ...actual, exec: vi.fn() };
});

const { exec } = await import("#exec");
const execMock = vi.mocked(exec);
const { onlyFailures, testRun } = await import("./test-run.js");

const base = {
  command: "tool",
  payload: (parsed: string) => ({ parsed }),
};

beforeEach(() => {
  execMock.mockReset();
});

describe("testRun stdout", () => {
  const run = (parse: (t: string) => string = (t) => t.toUpperCase()) =>
    testRun({ ...base, args: () => ["x"], artifact: "stdout", parse });

  it("parses stdout || stderr into the payload", async () => {
    execMock.mockResolvedValue(execFail("from stderr"));
    const r = await run();
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toEqual({ parsed: "FROM STDERR" });
  });

  it("answers the tail of the output for blank text, typed", async () => {
    execMock.mockResolvedValue(execFail("  ", 3));
    const r = await run();
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toBe("No test output received");
    expect(r.structuredContent).toMatchObject({ ok: false });
  });

  it("hands blank output to parse when parseBlank is set", async () => {
    execMock.mockResolvedValue(execOk(""));
    const r = await testRun({
      ...base,
      args: () => [],
      artifact: "stdout",
      parseBlank: true,
      parse: (t) => `[${t}]`,
    });
    expect(r.structuredContent).toEqual({ parsed: "[]" });
  });

  it("answers parse_failed when parse throws", async () => {
    execMock.mockResolvedValue(execOk("garbage"));
    const r = await run(() => {
      throw new Error("bad");
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      error: { kind: "parse_failed", command: "tool" },
    });
    expect(r.content[0]?.text).toContain("garbage");
  });

  it.each([
    ["ENOENT", { errorCode: "ENOENT" }, "missing_binary"],
    ["a timeout", { timedOut: true }, "timeout"],
  ])("classifies %s, keeping the tool's error fields", async (_n, extra, kind) => {
    execMock.mockResolvedValue({ ...execOk("{}"), exitCode: 1, ...extra });
    const r = await testRun({
      ...base,
      args: () => [],
      artifact: "stdout",
      parse: (t) => t,
      errorFields: (res) => ({ exitCode: res.exitCode }),
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      exitCode: 1,
      error: { kind, command: "tool" },
    });
  });

  it("passes cwd and timeout to exec", async () => {
    execMock.mockResolvedValue(execOk("x"));
    await testRun({
      ...base,
      args: () => ["a"],
      artifact: "stdout",
      cwd: "/w",
      timeout: 5,
      parse: (t) => t,
    });
    expect(execMock).toHaveBeenCalledWith("tool", ["a"], {
      cwd: "/w",
      timeout: 5,
    });
  });
});

describe("testRun file", () => {
  it("reads the file the CLI wrote, then removes it", async () => {
    let path = "";
    execMock.mockImplementation(async (_c, args) => {
      path = args[0] ?? "";
      writeFileSync(path, "report");
      return execOk("");
    });
    const r = await testRun({
      ...base,
      args: (p) => [p],
      artifact: "file",
      parse: (t) => t,
    });
    expect(r.structuredContent).toEqual({ parsed: "report" });
    expect(existsSync(path)).toBe(false);
  });

  it("answers an error with the last 500 chars when no file was written", async () => {
    execMock.mockResolvedValue(execFail(`${"a".repeat(600)}END`, 2));
    const r = await testRun({
      ...base,
      args: (p) => [p],
      artifact: "file",
      parse: (t) => t,
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toHaveLength(500);
    expect(r.content[0]?.text.endsWith("END")).toBe(true);
  });

  it("classifies a timeout even when a partial file exists", async () => {
    execMock.mockImplementation(async (_c, args) => {
      writeFileSync(args[0] ?? "", "partial");
      return { ...execOk(""), timedOut: true };
    });
    const r = await testRun({
      ...base,
      args: (p) => [p],
      artifact: "file",
      parse: (t) => t,
    });
    expect(r.structuredContent).toMatchObject({ error: { kind: "timeout" } });
  });

  it("gives concurrent runs distinct paths", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1);
    const paths: string[] = [];
    execMock.mockImplementation(async (_c, args) => {
      paths.push(args[0] ?? "");
      writeFileSync(args[0] ?? "", "x");
      return execOk("");
    });
    const go = () =>
      testRun({ ...base, args: (p) => [p], artifact: "file", parse: (t) => t });
    await Promise.all([go(), go()]);
    expect(new Set(paths).size).toBe(2);
  });
});

describe("testRun dir", () => {
  const run = () =>
    testRun({
      command: "tool",
      args: (d) => [d],
      artifact: "dir",
      suffix: ".trx",
      parse: (files: string[]) => files.join("|"),
      payload: (parsed) => ({ parsed }),
    });

  it("reads every matching file and ignores the rest", async () => {
    let dir = "";
    execMock.mockImplementation(async (_c, args) => {
      dir = args[0] ?? "";
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "a.trx"), "A");
      writeFileSync(join(dir, "b.trx"), "B");
      writeFileSync(join(dir, "c.log"), "C");
      return execOk("");
    });
    const r = await run();
    expect(r.structuredContent).toEqual({ parsed: "A|B" });
    expect(existsSync(dir)).toBe(false);
  });

  it("answers an error when no matching file exists", async () => {
    execMock.mockResolvedValue(execFail("build failed", 1));
    const r = await run();
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toBe("build failed");
  });
});

describe("onlyFailures", () => {
  const suites = [
    {
      file: "f",
      passed: 1,
      failed: 1,
      skipped: 0,
      duration: 0,
      tests: [
        { name: "a", status: "passed" as const, duration: 0 },
        { name: "b", status: "failed" as const, duration: 0 },
      ],
    },
  ];

  it("keeps only failed tests, leaving counts alone", () => {
    const out = onlyFailures(suites);
    expect(out[0]?.tests.map((t) => t.name)).toEqual(["b"]);
    expect(out[0]?.passed).toBe(1);
  });

  it("returns every test when verbose", () => {
    expect(onlyFailures(suites, true)[0]?.tests).toHaveLength(2);
  });
});
