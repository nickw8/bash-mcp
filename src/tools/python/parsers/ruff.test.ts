/**
 * Tests for the ruff diagnostic parser.
 */

import { describe, expect, it } from "vitest";
import { parseRuffDiagnostics } from "./ruff.js";

describe("parseRuffDiagnostics", () => {
  it("parses ruff JSON output", () => {
    const input = JSON.stringify([
      {
        code: "F401",
        filename: "src/app.py",
        location: { row: 1, column: 8 },
        end_location: { row: 1, column: 10 },
        message: "`os` imported but unused",
        severity: "error",
        fix: { applicability: "safe", edits: [] },
      },
    ]);

    const result = parseRuffDiagnostics(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: "src/app.py",
      line: 1,
      column: 8,
      message: "`os` imported but unused",
      severity: "error",
      rule: "F401",
    });
  });

  it("returns empty array for empty JSON array", () => {
    expect(parseRuffDiagnostics("[]")).toEqual([]);
  });

  it("returns empty array for non-JSON output", () => {
    expect(parseRuffDiagnostics("All checks passed!")).toEqual([]);
  });

  it("handles JSON prefixed with warnings", () => {
    const input = `warning: some deprecation\n${JSON.stringify([
      {
        code: "E501",
        filename: "x.py",
        location: { row: 3, column: 1 },
        message: "Line too long",
        severity: "warning",
      },
    ])}`;

    const result = parseRuffDiagnostics(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("warning");
  });
});
