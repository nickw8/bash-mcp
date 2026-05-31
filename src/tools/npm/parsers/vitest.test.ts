/**
 * Tests for the Vitest JSON result parser.
 */

import { describe, expect, it } from "vitest";
import { parseVitestResults } from "./vitest.js";

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
