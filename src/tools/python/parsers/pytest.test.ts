/**
 * Tests for the pytest JUnit-XML result parser.
 */

import { describe, expect, it } from "vitest";
import { parsePytestResults } from "./pytest.js";

describe("parsePytestResults", () => {
  it("parses JUnit XML with pass, fail, and skip", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites name="pytest tests">
  <testsuite name="pytest" errors="0" failures="1" skipped="1" tests="3" time="0.015">
    <testcase classname="test_sample" name="test_pass" time="0.001" />
    <testcase classname="test_sample" name="test_fail" time="0.002">
      <failure message="assert False">def test_fail():
&gt;       assert False
E       AssertionError</failure>
    </testcase>
    <testcase classname="test_sample" name="test_skip" time="0.000">
      <skipped type="pytest.skip" message="not ready" />
    </testcase>
  </testsuite>
</testsuites>`;

    const { suites, summary } = parsePytestResults(xml);
    expect(suites).toHaveLength(1);
    expect(suites[0]?.passed).toBe(1);
    expect(suites[0]?.failed).toBe(1);
    expect(suites[0]?.skipped).toBe(1);
    expect(suites[0]?.tests).toHaveLength(1);
    expect(suites[0]?.tests[0]?.status).toBe("failed");
    expect(suites[0]?.tests[0]?.failureMessage).toContain("assert False");
    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
  });

  it("returns empty suites for empty XML", () => {
    const xml = `<?xml version="1.0"?><testsuites><testsuite name="pytest" errors="0" failures="0" skipped="0" tests="0" time="0"></testsuite></testsuites>`;
    const { suites, summary } = parsePytestResults(xml);
    expect(suites).toEqual([]);
    expect(summary.total).toBe(0);
  });

  it("handles XML with no testsuites wrapper", () => {
    const xml = `<testsuite name="pytest" tests="1" errors="0" failures="0" skipped="0" time="0.01">
      <testcase classname="tests.test_app" name="test_hello" time="0.001" />
    </testsuite>`;
    const { summary } = parsePytestResults(xml);
    expect(summary.total).toBe(1);
    expect(summary.passed).toBe(1);
  });
});
