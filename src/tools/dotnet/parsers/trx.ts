/**
 * TRX (Visual Studio Test Results) XML parser.
 *
 * Extracts structured test results from the TRX files produced by
 * `dotnet test --logger:trx`. Uses regex rather than an XML parser to
 * avoid adding a dependency — TRX has a predictable structure with
 * `<UnitTestResult>` elements containing outcome, duration, and error info.
 */

import type { TestResult } from "#parsers";

/** Regex capturing UnitTestResult elements with their attributes and body. */
const RESULT_PATTERN =
  /<UnitTestResult[^>]*\btestName="([^"]*)"[^>]*\boutcome="([^"]*)"[^>]*(?:\/>|>([\s\S]*?)<\/UnitTestResult>)/g;

/** Regex capturing error message within an ErrorInfo block. */
const MESSAGE_PATTERN = /<Message>([\s\S]*?)<\/Message>/;

/** Regex capturing stack trace within an ErrorInfo block. */
const STACKTRACE_PATTERN = /<StackTrace>([\s\S]*?)<\/StackTrace>/;

/** Max stack trace frames to include in output. */
const MAX_STACK_FRAMES = 3;

/**
 * Parse TRX XML content into structured test results.
 *
 * Only failed tests include detailed messages and stack traces. Passing tests
 * are counted but not returned individually to minimize token usage. Stack
 * traces are truncated to 3 frames — deeper frames are typically framework
 * internals. Namespace prefixes matching the common root are stripped from
 * test names for brevity.
 */
export function parseTrxResults(trxContent: string): {
  results: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  total: number;
} {
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
      if (truncated && results.length > 0) {
        const last = results[results.length - 1]!;
        last.failureMessage = last.failureMessage
          ? `${last.failureMessage}\n${truncated}`
          : truncated;
      }
    }
  }

  const total = passed + failed + skipped;

  // Strip common namespace prefix from test names
  stripNamespacePrefix(results);

  return { results, passed, failed, skipped, total };
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

/**
 * Strip the longest common dotted namespace prefix from test names in-place.
 * E.g. `MyApp.Tests.Services.AuthTests.ShouldWork` → `AuthTests.ShouldWork`
 * when all tests share `MyApp.Tests.Services`.
 */
function stripNamespacePrefix(results: TestResult[]): void {
  if (results.length === 0) return;

  const names = results.map((r) => r.name);
  const segments = names[0]!.split(".");
  let prefixLen = 0;

  // Keep at least the last 2 segments (ClassName.MethodName)
  for (let i = 0; i < segments.length - 2; i++) {
    const candidate = `${segments.slice(0, i + 1).join(".")}.`;
    if (names.every((n) => n.startsWith(candidate))) {
      prefixLen = candidate.length;
    } else {
      break;
    }
  }

  if (prefixLen > 0) {
    for (const r of results) {
      r.name = r.name.slice(prefixLen);
    }
  }
}
