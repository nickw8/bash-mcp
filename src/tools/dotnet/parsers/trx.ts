/**
 * TRX (Visual Studio Test Results) XML parser.
 *
 * Extracts structured test results from the TRX files produced by
 * `dotnet test --logger:trx`. Uses regex rather than an XML parser to
 * avoid adding a dependency — TRX has a predictable structure with
 * `<UnitTestResult>` elements containing outcome, duration, and error info.
 */

import type { TestResult } from "#parsers";
import { stripCommonPrefix } from "../../../parsers/strip-prefix.js";

/**
 * Regex capturing UnitTestResult elements with their attributes and body.
 *
 * The segment before the closing alternation is lazy (`[^>]*?`) so a
 * self-closing `/>` is preferred over the `>...</UnitTestResult>` body branch.
 * A greedy `[^>]*` would stop at the `>` of `/>`, letting the body branch swallow
 * everything up to the next failed element's `</UnitTestResult>` — silently
 * dropping any self-closing (passing) result that precedes a failure in the file.
 */
const RESULT_PATTERN =
  /<UnitTestResult[^>]*\btestName="([^"]*)"[^>]*\boutcome="([^"]*)"[^>]*?(?:\/>|>([\s\S]*?)<\/UnitTestResult>)/g;

/** Regex capturing error message within an ErrorInfo block. */
const MESSAGE_PATTERN = /<Message>([\s\S]*?)<\/Message>/;

/** Regex capturing stack trace within an ErrorInfo block. */
const STACKTRACE_PATTERN = /<StackTrace>([\s\S]*?)<\/StackTrace>/;

/** Max stack trace frames to include in output. */
const MAX_STACK_FRAMES = 3;

/** Aggregate test outcome shared by per-file parsing and multi-file aggregation. */
export interface TrxSummary {
  results: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

/**
 * Parse TRX XML content into structured test results.
 *
 * Only failed tests include detailed messages and stack traces. Passing tests
 * are counted but not returned individually to minimize token usage. Stack
 * traces are truncated to 3 frames — deeper frames are typically framework
 * internals. Namespace prefixes matching the common root are stripped from
 * test names for brevity.
 */
export function parseTrxResults(trxContent: string): TrxSummary {
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const match of trxContent.matchAll(RESULT_PATTERN)) {
    const testName = unescapeXml(match[1] ?? "");
    const outcome = match[2] ?? "";
    const body = match[3] ?? "";

    const status = mapOutcome(outcome);

    if (status === "passed") {
      passed++;
      continue;
    }

    if (status === "skipped") {
      skipped++;
      continue;
    }

    // Failed — extract error details
    failed++;
    const messageMatch = body.match(MESSAGE_PATTERN);
    const stackMatch = body.match(STACKTRACE_PATTERN);

    results.push({
      name: testName,
      status: "failed",
      duration: 0,
      failureMessage: messageMatch
        ? unescapeXml(messageMatch[1] ?? "").trim()
        : undefined,
    });

    if (stackMatch) {
      const truncated = truncateStackTrace(
        unescapeXml(stackMatch[1] ?? "").trim(),
      );
      const last = results[results.length - 1];
      if (truncated && last) {
        last.failureMessage = last.failureMessage
          ? `${last.failureMessage}\n${truncated}`
          : truncated;
      }
    }
  }

  const total = passed + failed + skipped;

  // Strip common namespace prefix from test names (keep ClassName.Method)
  const stripped = stripCommonPrefix(
    results.map((r) => r.name),
    ".",
    2,
  );
  results.forEach((r, i) => {
    r.name = stripped[i] ?? r.name;
  });

  return { results, passed, failed, skipped, total };
}

/**
 * Aggregate multiple TRX files (one per test project in a multi-project run)
 * into a single summary: counts are summed and failure lists concatenated.
 *
 * Each file is parsed independently, so namespace-prefix stripping stays
 * per-file (a shared prefix across projects is rare and stripping across the
 * merged set could over-trim distinct roots).
 */
export function aggregateTrx(contents: string[]): TrxSummary {
  const merged: TrxSummary = {
    results: [],
    passed: 0,
    failed: 0,
    skipped: 0,
    total: 0,
  };
  for (const content of contents) {
    const parsed = parseTrxResults(content);
    merged.results.push(...parsed.results);
    merged.passed += parsed.passed;
    merged.failed += parsed.failed;
    merged.skipped += parsed.skipped;
    merged.total += parsed.total;
  }
  return merged;
}

/** Map TRX outcome strings to our canonical status values. */
function mapOutcome(outcome: string): "passed" | "failed" | "skipped" {
  switch (outcome.toLowerCase()) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "notexecuted":
    case "inconclusive":
    case "skipped":
      return "skipped";
    default:
      return "failed";
  }
}

/** Truncate a stack trace to the first N frames. */
function truncateStackTrace(stack: string): string {
  const lines = stack.split("\n").filter((l) => l.trim().startsWith("at "));
  if (lines.length <= MAX_STACK_FRAMES) return lines.join("\n");
  return `${lines.slice(0, MAX_STACK_FRAMES).join("\n")}\n  ... ${lines.length - MAX_STACK_FRAMES} more frames`;
}

/** Unescape basic XML entities. */
function unescapeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
