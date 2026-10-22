import { describe, expect, it } from "vitest";
import { err } from "#response";
import {
  compactDiagnostics,
  diagnosticRows,
  diagnosticRun,
  diagnosticsResponse,
} from "./diagnostics-response.js";
import type { Diagnostic } from "./types.js";

const e0: Diagnostic = {
  file: "a.ts",
  line: 12,
  column: 9,
  severity: "error",
  rule: "TS2304",
  message: "x",
};
const e1: Diagnostic = {
  file: "a.ts",
  line: 20,
  column: 1,
  severity: "error",
  rule: "TS2305",
  message: "y",
};
const e2: Diagnostic = {
  file: "b.ts",
  line: 4,
  column: 3,
  severity: "error",
  rule: "TS2554",
  message: "z",
};
const ERRORS = [e0, e1, e2];

describe("diagnosticRows", () => {
  it("drops severity when uniform, combines line:col, keeps rule + message", () => {
    expect(diagnosticRows([e0])).toEqual([
      { file: "a.ts", loc: "12:9", rule: "TS2304", message: "x" },
    ]);
  });

  it("includes severity when the set is mixed", () => {
    const warn: Diagnostic = {
      file: "a.ts",
      line: 5,
      column: 2,
      severity: "warning",
      message: "w",
    };
    const rows = diagnosticRows([e0, warn]);
    expect(rows[0]).toHaveProperty("severity", "error");
    expect(rows[1]).toHaveProperty("severity", "warning");
  });

  it("omits rule when a diagnostic has none", () => {
    const noRule: Diagnostic = {
      file: "a.ts",
      line: 1,
      column: 1,
      severity: "error",
      message: "m",
    };
    expect(diagnosticRows([noRule])[0]).not.toHaveProperty("rule");
  });
});

describe("compactDiagnostics", () => {
  it("pays each path once and encodes findings as strings", () => {
    expect(compactDiagnostics(ERRORS)).toEqual([
      { file: "a.ts", items: ["12:9 TS2304 x", "20:1 TS2305 y"] },
      { file: "b.ts", items: ["4:3 TS2554 z"] },
    ]);
  });

  it("prefixes severity only when the set is mixed", () => {
    const warn: Diagnostic = {
      file: "a.ts",
      line: 5,
      column: 2,
      severity: "warning",
      message: "w",
    };
    expect(compactDiagnostics([e0, warn])).toEqual([
      { file: "a.ts", items: ["12:9 error TS2304 x", "5:2 warning w"] },
    ]);
  });
});

describe("diagnosticsResponse", () => {
  it("groups by file in both the payload and the text block", () => {
    const res = diagnosticsResponse({ errorCount: 3, success: false }, ERRORS, {
      meta: { errorCount: 3 },
    });
    expect(res.structuredContent).toEqual({
      errorCount: 3,
      success: false,
      errors: compactDiagnostics(ERRORS),
    });
    expect(res.content[0]?.text).toBe(
      "errorCount\t3\n---\na.ts:\n12:9\tTS2304\tx\n20:1\tTS2305\ty\nb.ts:\n4:3\tTS2554\tz",
    );
  });

  it("caps the payload as well as the text block", () => {
    const res = diagnosticsResponse({}, ERRORS, {
      budget: { maxItems: 1 },
      meta: { errorCount: 3 },
    });
    expect(res.structuredContent).toEqual({
      errors: [{ file: "a.ts", items: ["12:9 TS2304 x"] }],
      total: 3,
      truncated: true,
    });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("shown\t1");
    expect(text).toContain("total\t3");
    expect(text).not.toContain("b.ts:");
  });

  it("writes the list under the caller's key", () => {
    const res = diagnosticsResponse({}, ERRORS, { key: "diagnostics" });
    expect(res.structuredContent).toHaveProperty("diagnostics");
    expect(res.structuredContent).not.toHaveProperty("errors");
  });

  it("json format summarizes the payload instead of repeating it", () => {
    const res = diagnosticsResponse({ errorCount: 3 }, ERRORS, {
      format: "json",
    });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("errorCount=3");
    expect(text.length).toBeLessThan(
      JSON.stringify(res.structuredContent).length,
    );
  });
});

describe("diagnosticRun", () => {
  const res = (stdout: string, stderr = "", exitCode = 0) => ({
    stdout,
    stderr,
    exitCode,
  });
  const warn: Diagnostic = { ...e0, severity: "warning", rule: "W1" };
  const info: Diagnostic = { ...e1, severity: "info", rule: "I1" };
  // Parser: each line is a key into a fixed table.
  const table: Record<string, Diagnostic> = { e0, e1, warn, info };
  const parse = (t: string) =>
    t
      .split("\n")
      .filter(Boolean)
      .map((l) => table[l] as Diagnostic);

  it("reads stdout, falling back to stderr", () => {
    const a = diagnosticRun({ results: res("e0", "e1"), parse, command: "x" });
    expect(a.structuredContent).toMatchObject({ errorCount: 1 });
    expect(a.structuredContent.errors[0]?.items).toHaveLength(1);
    const b = diagnosticRun({
      results: res("", "e0\ne1"),
      parse,
      command: "x",
    });
    expect(b.structuredContent).toMatchObject({ errorCount: 2 });
  });

  it("reads stderr only when asked, merging a list of results", () => {
    const r = diagnosticRun({
      command: "x",
      results: [res("e0", "e1"), res("e0", "e1")],
      parse,
      stream: "stderr",
      count: "total",
    });
    expect(r.structuredContent).toMatchObject({ errorCount: 2 });
  });

  it("counts before the minSeverity filter", () => {
    const r = diagnosticRun({
      command: "x",
      results: res("e0\nwarn\ninfo"),
      parse,
      minSeverity: "error",
    });
    expect(r.structuredContent).toMatchObject({
      errorCount: 1,
      warningCount: 1,
    });
    expect(r.structuredContent.errors).toEqual([
      { file: "a.ts", items: ["12:9 TS2304 x"] },
    ]);
  });

  it("reads a fixed count and maps extra fields", () => {
    const r = diagnosticRun({
      command: "x",
      results: res("e0\nFixed 3 files"),
      parse: (t) => parse(t.replace(/Fixed.*/, "")),
      fixedPattern: /Fixed (\d+) file/,
      fields: (c, [x]) => ({ ok: x?.exitCode === 0, seen: c.fixedCount }),
      metaKeys: ["errorCount"],
    });
    expect(r.structuredContent).toMatchObject({
      errorCount: 1,
      warningCount: 0,
      fixedCount: 3,
      ok: true,
      seen: 3,
    });
    expect(r.content[0]?.text).toContain("errorCount");
    expect(r.content[0]?.text).not.toContain("fixedCount");
  });

  it("answers bare ok for blank output or no findings, as asked", () => {
    const blank = diagnosticRun({
      command: "x",
      results: res("  "),
      parse: () => {
        throw new Error("never called");
      },
      bareWhen: "blank-output",
      fixedPattern: /Fixed (\d+)/,
    });
    expect(blank.structuredContent).toEqual({
      errors: [],
      errorCount: 0,
      warningCount: 0,
      fixedCount: 0,
    });
    const none = diagnosticRun({
      command: "x",
      results: res("warn"),
      parse,
      minSeverity: "error",
      bareWhen: "no-findings",
    });
    expect(none.structuredContent).toEqual({
      errors: [],
      errorCount: 0,
      warningCount: 1,
    });
    const listed = diagnosticRun({ results: res("x"), parse: () => [] });
    expect(listed.structuredContent).toEqual({
      errorCount: 0,
      warningCount: 0,
      errors: [],
    });
  });

  it("routes a throwing parser to onParseError", () => {
    const r = diagnosticRun({
      command: "x",
      results: res("garbage"),
      parse: () => {
        throw new Error("bad");
      },
      onParseError: (t) => err(`bad: ${t}`),
    });
    expect(r.content[0]?.text).toBe("bad: garbage");
  });
});

describe("diagnosticRun failure policy", () => {
  const base = { stdout: "", stderr: "", exitCode: 0 };
  const parseOne = (t: string): Diagnostic[] =>
    t.includes("finding") ? [e0] : [];

  it("a binary that never ran is a missing_binary error, not zero errors", () => {
    const r = diagnosticRun({
      results: { ...base, exitCode: 1, errorCode: "ENOENT" },
      parse: parseOne,
      command: "ruff",
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      ok: false,
      error: { kind: "missing_binary", command: "ruff" },
    });
  });

  it("flags ENOENT on any result of a merged list", () => {
    const r = diagnosticRun({
      results: [base, { ...base, exitCode: 1, errorCode: "ENOENT" }],
      parse: parseOne,
      command: "bash",
    });
    expect(r.structuredContent).toMatchObject({
      error: { kind: "missing_binary" },
    });
  });

  it("a timeout-killed run is a timeout error even with partial findings", () => {
    const r = diagnosticRun({
      results: { stdout: "finding", stderr: "", exitCode: 1, timedOut: true },
      parse: parseOne,
      command: "mypy",
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ error: { kind: "timeout" } });
  });

  it("non-zero exit with nothing parsed is an error carrying an output tail", () => {
    const r = diagnosticRun({
      results: { stdout: "", stderr: "x".repeat(800), exitCode: 2 },
      parse: parseOne,
      command: "tsc",
    });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      ok: false,
      error: { kind: "command_failed", exitCode: 2 },
    });
    expect(r.content[0]?.text.length).toBeLessThanOrEqual(500);
    expect(r.content[0]?.text).toContain("xxx");
  });

  it("non-zero exit WITH findings stays a normal result", () => {
    const r = diagnosticRun({
      results: { stdout: "finding", stderr: "", exitCode: 1 },
      parse: parseOne,
      command: "ruff",
    });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ errorCount: 1 });
  });

  it("judges nothing-parsed before minSeverity filtering", () => {
    const warnOnly = (): Diagnostic[] => [{ ...e0, severity: "warning" }];
    const r = diagnosticRun({
      results: { stdout: "w", stderr: "", exitCode: 1 },
      parse: warnOnly,
      minSeverity: "error",
      command: "ruff",
    });
    expect(r.isError).toBeUndefined();
  });

  it("zero exit and nothing parsed is still a clean result", () => {
    const r = diagnosticRun({
      results: base,
      parse: parseOne,
      command: "ruff",
    });
    expect(r.isError).toBeUndefined();
  });
});
