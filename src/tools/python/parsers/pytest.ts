import type { TestResult, TestSuite } from "#parsers";
import { stripCommonPrefix } from "../../../parsers/strip-prefix.js";

const TESTCASE_PATTERN =
  /<testcase\s[^>]*classname="([^"]*)"[^>]*name="([^"]*)"[^>]*time="([^"]*)"[^/>]*(?:\/>|>([\s\S]*?)<\/testcase>)/g;

const FAILURE_PATTERN =
  /<failure[^>]*(?:message="([^"]*)")?[^>]*>([\s\S]*?)<\/failure>/;

const SKIPPED_PATTERN = /<skipped[^>]*\/?>(?:[\s\S]*?<\/skipped>)?/;

const MAX_STACK_FRAMES = 5;

export function parsePytestResults(xml: string): {
  suites: TestSuite[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
} {
  const tests: TestResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const match of xml.matchAll(TESTCASE_PATTERN)) {
    const classname = unescapeXml(match[1] ?? "");
    const name = unescapeXml(match[2] ?? "");
    const time = parseFloat(match[3] ?? "0");
    const body = match[4] ?? "";
    const duration = Math.round(time * 1000);

    const fullName = classname ? `${classname}.${name}` : name;

    const failureMatch = body.match(FAILURE_PATTERN);
    const skippedMatch = body.match(SKIPPED_PATTERN);

    if (failureMatch) {
      totalFailed++;
      const message = failureMatch[1]
        ? unescapeXml(failureMatch[1])
        : undefined;
      const traceback = truncateTraceback(
        unescapeXml(failureMatch[2] ?? "").trim(),
      );
      tests.push({
        name: fullName,
        status: "failed",
        duration,
        failureMessage: message
          ? traceback
            ? `${message}\n${traceback}`
            : message
          : traceback || undefined,
      });
    } else if (skippedMatch) {
      totalSkipped++;
    } else {
      totalPassed++;
    }
  }

  // Strip common prefix from test names
  const stripped = stripCommonPrefix(
    tests.map((t) => t.name),
    ".",
    2,
  );
  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    const name = stripped[i];
    if (test && name !== undefined) test.name = name;
  }

  // Group into a single suite (pytest JUnit XML uses one suite)
  const suite: TestSuite = {
    file: "pytest",
    tests,
    passed: totalPassed,
    failed: totalFailed,
    skipped: totalSkipped,
    duration: tests.reduce((sum, t) => sum + t.duration, 0),
  };

  const total = totalPassed + totalFailed + totalSkipped;

  return {
    suites: total > 0 ? [suite] : [],
    summary: {
      total,
      passed: totalPassed,
      failed: totalFailed,
      skipped: totalSkipped,
      duration: suite.duration,
    },
  };
}

function truncateTraceback(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= MAX_STACK_FRAMES) return text;
  return `${lines.slice(0, MAX_STACK_FRAMES).join("\n")}\n  ... ${lines.length - MAX_STACK_FRAMES} more lines`;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r");
}
