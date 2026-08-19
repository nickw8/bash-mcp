import { describe, expect, it } from "vitest";
import {
  compactDiagnostics,
  diagnosticRows,
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
