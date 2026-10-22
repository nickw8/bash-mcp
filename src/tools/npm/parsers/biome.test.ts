/**
 * Tests for the Biome diagnostic parser.
 */

import { describe, expect, it } from "vitest";
import { parseBiomeDiagnostics } from "./biome.js";

describe("parseBiomeDiagnostics", () => {
  it("parses biome JSON diagnostics", () => {
    const input = JSON.stringify({
      diagnostics: [
        {
          category: "lint/style/noNonNullAssertion",
          severity: "warning",
          description: "Forbidden non-null assertion.",
          location: {
            path: { file: "src/app.ts" },
            span: { start: 0, end: 10 },
            sourceCode: "const x = y!;",
          },
        },
      ],
    });

    const result = parseBiomeDiagnostics(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("warning");
    expect(result[0]?.rule).toBe("lint/style/noNonNullAssertion");
    expect(result[0]?.file).toBe("src/app.ts");
  });

  it("parses real biome 2.x JSON output", () => {
    const input = JSON.stringify({
      summary: { changed: 0, unchanged: 1, errors: 1, warnings: 1 },
      diagnostics: [
        {
          severity: "warning",
          message: "This variable x is unused.",
          category: "lint/correctness/noUnusedVariables",
          location: {
            path: "a.js",
            start: { line: 1, column: 5 },
            end: { line: 1, column: 6 },
          },
          advices: [],
        },
        {
          severity: "error",
          message: "This is an unexpected use of the debugger statement.",
          category: "lint/suspicious/noDebugger",
          location: {
            path: "a.js",
            start: { line: 2, column: 1 },
            end: { line: 2, column: 10 },
          },
          advices: [],
        },
      ],
      command: "lint",
    });

    expect(parseBiomeDiagnostics(input)).toEqual([
      {
        file: "a.js",
        line: 1,
        column: 5,
        severity: "warning",
        rule: "lint/correctness/noUnusedVariables",
        message: "This variable x is unused.",
      },
      {
        file: "a.js",
        line: 2,
        column: 1,
        severity: "error",
        rule: "lint/suspicious/noDebugger",
        message: "This is an unexpected use of the debugger statement.",
      },
    ]);
  });
});
