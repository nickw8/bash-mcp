import type { TestResult } from "#parsers";

/** Aggregated pass/fail counts from a shell test run. */
export interface BashTestSummary {
  passed: number;
  failed: number;
  total: number;
}

export interface BashTestParse {
  /** Counts when a recognizable format was found, else null. */
  summary: BashTestSummary | null;
  /** Individual cases when the output is TAP, else []. */
  tests: TestResult[];
}

// TAP test line: "ok 1 - desc" / "not ok 2 - desc" (number required to avoid
// matching plain "ok"/"not ok" prose). A trailing "# SKIP"/"# TODO" directive
// marks the case as skipped.
const TAP_LINE = /^(ok|not ok)\s+\d+(?:\s+-)?\s*(.*)$/;
const TAP_DIRECTIVE = /#\s*(skip|todo)\b/i;
// bats / JUnit style: "5 tests, 1 failure".
const TESTS_FAILURES = /(\d+)\s+tests?,\s+(\d+)\s+failures?/i;
// pytest / generic style: "5 passed, 1 failed".
const PASSED_FAILED = /(\d+)\s+passed(?:,\s+(\d+)\s+failed)?/i;

/**
 * Parse shell test-harness output into a structured summary. Prefers TAP
 * (`ok`/`not ok` lines) when present — yielding per-case results — then falls
 * back to `N tests, M failures` and `N passed, M failed` summary lines.
 * Returns `{ summary: null, tests: [] }` when nothing recognizable is found,
 * so the caller can degrade to exit-code-only.
 */
export function parseBashTest(text: string): BashTestParse {
  const tests: TestResult[] = [];

  for (const raw of text.split("\n")) {
    const match = raw.trim().match(TAP_LINE);
    if (!match) continue;

    const name = match[2]?.trim() || `test ${tests.length + 1}`;
    const status: TestResult["status"] = TAP_DIRECTIVE.test(name)
      ? "skipped"
      : match[1] === "ok"
        ? "passed"
        : "failed";
    tests.push({ name, status, duration: 0 });
  }

  if (tests.length > 0) {
    const passed = tests.filter((t) => t.status === "passed").length;
    const failed = tests.filter((t) => t.status === "failed").length;
    return { summary: { passed, failed, total: tests.length }, tests };
  }

  const tf = text.match(TESTS_FAILURES);
  if (tf) {
    const total = parseInt(tf[1] ?? "0", 10);
    const failed = parseInt(tf[2] ?? "0", 10);
    return { summary: { passed: total - failed, failed, total }, tests: [] };
  }

  const pf = text.match(PASSED_FAILED);
  if (pf) {
    const passed = parseInt(pf[1] ?? "0", 10);
    const failed = pf[2] ? parseInt(pf[2], 10) : 0;
    return { summary: { passed, failed, total: passed + failed }, tests: [] };
  }

  return { summary: null, tests: [] };
}
