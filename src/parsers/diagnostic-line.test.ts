import { describe, expect, it } from "vitest";
import { parseDiagnosticLines } from "./diagnostic-line.js";

// tsc/tsgo-style: path(line,col): severity TSxxxx: message
const TSC = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

describe("parseDiagnosticLines", () => {
  it("parses a single diagnostic line into a structured Diagnostic", () => {
    const out = parseDiagnosticLines(
      "src/x.ts(10,5): error TS2304: Cannot find name 'foo'.",
      TSC,
    );
    expect(out).toEqual([
      {
        file: "src/x.ts",
        line: 10,
        column: 5,
        severity: "error",
        rule: "TS2304",
        message: "Cannot find name 'foo'.",
      },
    ]);
  });

  it("parses multiple lines and skips non-matching ones", () => {
    const text = [
      "Compiling...",
      "src/a.ts(1,1): error TS1005: ';' expected.",
      "some unrelated log line",
      "src/b.ts(20,3): warning TS6133: 'x' is declared but never used.",
      "Found 2 errors.",
    ].join("\n");

    const out = parseDiagnosticLines(text, TSC);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      file: "src/a.ts",
      severity: "error",
      rule: "TS1005",
    });
    expect(out[1]).toMatchObject({
      file: "src/b.ts",
      line: 20,
      column: 3,
      severity: "warning",
      rule: "TS6133",
    });
  });

  it("returns an empty array when nothing matches", () => {
    expect(parseDiagnosticLines("no diagnostics here\nat all", TSC)).toEqual(
      [],
    );
  });

  it("parses numeric line/column as integers", () => {
    const out = parseDiagnosticLines("f.ts(123,45): error TS1: msg", TSC);
    expect(out[0]?.line).toBe(123);
    expect(out[0]?.column).toBe(45);
    expect(typeof out[0]?.line).toBe("number");
  });

  it("captures the rule/code group", () => {
    const out = parseDiagnosticLines("f.ts(1,1): warning TS6133: unused", TSC);
    expect(out[0]?.rule).toBe("TS6133");
    expect(out[0]?.severity).toBe("warning");
  });
});
