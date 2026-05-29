import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { parseMypyOutput } from "./parsers/mypy.js";
import { parsePytestResults } from "./parsers/pytest.js";
import { parseRuffDiagnostics } from "./parsers/ruff.js";
import { registerPythonTools } from "./python.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerPythonTools(server);
  return server;
}

describe("registerPythonTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});

describe("parseMypyOutput", () => {
  it("parses mypy error lines with column numbers", () => {
    const input = `src/app.py:10:5: error: Incompatible types in assignment  [assignment]
src/util.py:3:1: error: Cannot find name 'foo'  [name-defined]`;

    const result = parseMypyOutput(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      file: "src/app.py",
      line: 10,
      column: 5,
      message: "Incompatible types in assignment",
      severity: "error",
      rule: "assignment",
    });
  });

  it("maps note severity to info", () => {
    const input =
      'src/app.py:5:1: note: Revealed type is "builtins.int"  [misc]';
    const result = parseMypyOutput(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("info");
  });

  it("returns empty array for clean output", () => {
    expect(parseMypyOutput("")).toEqual([]);
    expect(parseMypyOutput("Success: no issues found")).toEqual([]);
  });
});

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
