import type { TestResult, TestSuite } from "./types.js";

/**
 * Parse vitest's JSON reporter output into structured test suites.
 *
 * Vitest's --reporter=json outputs a JSON object with `testResults` array
 * and `numTotalTests`, `numPassedTests`, etc. summary fields.
 */
export function parseVitestResults(raw: string): {
  suites: TestSuite[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
} {
  const json = JSON.parse(raw);

  const testResults: unknown[] = json.testResults ?? [];
  const suites: TestSuite[] = testResults
    .filter(
      (r): r is Record<string, unknown> => r != null && typeof r === "object",
    )
    .map((suite) => {
      const assertions: unknown[] = (suite.assertionResults as unknown[]) ?? [];
      const tests: TestResult[] = assertions
        .filter(
          (a): a is Record<string, unknown> =>
            a != null && typeof a === "object",
        )
        .map((a) => ({
          name:
            ((a.ancestorTitles as string[]) ?? [])
              .concat((a.title as string) ?? "")
              .join(" > ") ||
            (a.fullName as string) ||
            "unknown",
          status: mapStatus(a.status as string),
          duration: (a.duration as number) ?? 0,
          failureMessage:
            ((a.failureMessages as string[]) ?? []).join("\n") || undefined,
        }));

      const passed = tests.filter((t) => t.status === "passed").length;
      const failed = tests.filter((t) => t.status === "failed").length;
      const skipped = tests.filter((t) => t.status === "skipped").length;

      return {
        file: (suite.name as string) ?? "",
        tests,
        passed,
        failed,
        skipped,
        duration:
          ((suite.endTime as number) ?? 0) - ((suite.startTime as number) ?? 0),
      };
    });

  return {
    suites,
    summary: {
      total: (json.numTotalTests as number) ?? 0,
      passed: (json.numPassedTests as number) ?? 0,
      failed: (json.numFailedTests as number) ?? 0,
      skipped:
        ((json.numPendingTests as number) ?? 0) +
        ((json.numTodoTests as number) ?? 0),
      duration:
        ((json.endTime as number) ?? 0) - ((json.startTime as number) ?? 0),
    },
  };
}

/** Normalize vitest status strings to our three-value enum. */
function mapStatus(s: string): "passed" | "failed" | "skipped" {
  if (s === "passed") return "passed";
  if (s === "failed") return "failed";
  return "skipped";
}
