/**
 * Tests for npm tools (npm_lint, npm_test, npm_typecheck) and parsers.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerNpmTools } from "./npm.js";
import { parseBiomeDiagnostics } from "./parsers/biome.js";
import { parseTscOutput } from "./parsers/tsc.js";
import { parseVitestResults } from "./parsers/vitest.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerNpmTools(server);
  return server;
}

describe("registerNpmTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});

describe("parseTscOutput", () => {
  it("parses tsc error lines", () => {
    const input = `src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/util.ts(3,1): error TS2304: Cannot find name 'foo'.`;

    const result = parseTscOutput(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      file: "src/app.ts",
      line: 10,
      column: 5,
      message: "Type 'string' is not assignable to type 'number'.",
      severity: "error",
      rule: "TS2322",
    });
  });

  it("returns empty array for clean output", () => {
    expect(parseTscOutput("")).toEqual([]);
    expect(parseTscOutput("No errors found.")).toEqual([]);
  });
});

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
});

describe("parseVitestResults", () => {
  it("parses vitest JSON output", () => {
    const input = JSON.stringify({
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 1,
      numPendingTests: 0,
      numTodoTests: 0,
      startTime: 1000,
      endTime: 2000,
      testResults: [
        {
          name: "src/app.test.ts",
          startTime: 1000,
          endTime: 1500,
          assertionResults: [
            {
              ancestorTitles: ["App"],
              title: "renders",
              status: "passed",
              duration: 50,
              failureMessages: [],
            },
            {
              ancestorTitles: ["App"],
              title: "handles error",
              status: "failed",
              duration: 30,
              failureMessages: ["Expected true to be false"],
            },
          ],
        },
      ],
    });

    const { suites, summary } = parseVitestResults(input);
    expect(suites).toHaveLength(1);
    expect(suites[0]?.passed).toBe(1);
    expect(suites[0]?.failed).toBe(1);
    expect(suites[0]?.tests).toHaveLength(2);
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.duration).toBe(1000);
  });
});
