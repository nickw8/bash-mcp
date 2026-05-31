import { describe, expect, it } from "vitest";
import { diagnosticRows, diagnosticsResponse } from "./diagnostics-response.js";
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

describe("diagnosticsResponse", () => {
  it("groups by file in the text block and leaves structuredContent intact", () => {
    const structured = { errors: ERRORS, errorCount: 3, success: false };
    const res = diagnosticsResponse(structured, ERRORS, {
      meta: { errorCount: 3 },
    });
    expect(res.structuredContent).toBe(structured);
    expect(res.content[0]?.text).toBe(
      "errorCount\t3\n---\na.ts:\n12:9\tTS2304\tx\n20:1\tTS2305\ty\nb.ts:\n4:3\tTS2554\tz",
    );
  });

  it("caps with maxItems and notes shown/total", () => {
    const res = diagnosticsResponse({ errors: ERRORS }, ERRORS, {
      budget: { maxItems: 1 },
      meta: { errorCount: 3 },
    });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("shown\t1");
    expect(text).toContain("total\t3");
    expect(text).toContain("a.ts:");
    expect(text).not.toContain("b.ts:");
  });

  it("json format emits the structuredContent JSON verbatim", () => {
    const structured = { errors: ERRORS, errorCount: 3 };
    const res = diagnosticsResponse(structured, ERRORS, { format: "json" });
    expect(res.content[0]?.text).toBe(JSON.stringify(structured));
  });
});
