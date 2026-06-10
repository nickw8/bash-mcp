/**
 * Fixture-driven tests for the pure shell test-output parser.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBashTest } from "./bash-test.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/shell",
);
const load = (name: string) => readFileSync(join(fixtures, name), "utf8");

describe("parseBashTest", () => {
  it("parses TAP lines into per-case results and a summary", () => {
    const { summary, tests } = parseBashTest(load("bash-test-tap.txt"));
    expect(tests).toHaveLength(3);
    expect(tests[0]).toEqual({
      name: "adds numbers",
      status: "passed",
      duration: 0,
    });
    expect(tests[1]?.status).toBe("failed");
    // "# SKIP" directive overrides the leading "ok"
    expect(tests[2]?.status).toBe("skipped");
    expect(summary).toEqual({ passed: 1, failed: 1, total: 3 });
  });

  it("parses real bats --tap output: failure detail + inline skip directive", () => {
    const { summary, tests } = parseBashTest(load("bash-test-bats.txt"));
    expect(tests).toHaveLength(3);
    expect(tests[0]).toEqual({
      name: "adds numbers",
      status: "passed",
      duration: 0,
    });
    // bats diagnostic lines after "not ok" become the failureMessage.
    expect(tests[1]?.status).toBe("failed");
    expect(tests[1]?.name).toBe("subtracts numbers (intentionally wrong)");
    expect(tests[1]?.failureMessage).toContain("line 8");
    expect(tests[1]?.failureMessage).toContain("failed");
    // Inline "# skip" directive → skipped, with the directive stripped from name.
    expect(tests[2]?.status).toBe("skipped");
    expect(tests[2]?.name).toBe("skipped example");
    expect(summary).toEqual({ passed: 1, failed: 1, total: 3 });
  });

  it("parses a 'N tests, M failures' summary line (no TAP)", () => {
    const { summary, tests } = parseBashTest(load("bash-test-summary.txt"));
    expect(tests).toEqual([]);
    expect(summary).toEqual({ passed: 4, failed: 1, total: 5 });
  });

  it("parses a 'N passed, M failed' summary line", () => {
    const { summary } = parseBashTest("Results: 5 passed, 1 failed");
    expect(summary).toEqual({ passed: 5, failed: 1, total: 6 });
  });

  it("returns null summary when nothing is recognizable", () => {
    const { summary, tests } = parseBashTest(load("bash-test-plain.txt"));
    expect(summary).toBeNull();
    expect(tests).toEqual([]);
  });
});
