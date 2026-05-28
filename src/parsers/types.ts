/**
 * Shared parser types for structured CLI output.
 *
 * These interfaces are the canonical shapes returned by tool-specific parsers
 * (MSBuild, tsc, Biome, Vitest, TRX, etc.). Keeping them in one place ensures
 * consistent output across tool groups and makes it easy to add new parsers
 * that produce the same shapes.
 */

/** A single diagnostic (lint error, type error, build error, etc.) with source location. */
export interface Diagnostic {
  /** Relative path to the source file. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
  /** Human-readable diagnostic message. */
  message: string;
  /** Severity level. */
  severity: "error" | "warning" | "info";
  /** Tool-specific rule or error code (e.g. TS2322, CS0618, lint/suspicious). */
  rule?: string;
}

/** Result of a single test case. */
export interface TestResult {
  /** Test name, possibly including ancestor suite names joined by " > ". */
  name: string;
  /** Test outcome. */
  status: "passed" | "failed" | "skipped";
  /** Duration in milliseconds. */
  duration: number;
  /** Failure message including assertion details. Only present for failed tests. */
  failureMessage?: string;
}

/** Aggregated results for a single test file or suite. */
export interface TestSuite {
  /** Path to the test file. */
  file: string;
  /** Individual test results within this suite. */
  tests: TestResult[];
  /** Count of passed tests. */
  passed: number;
  /** Count of failed tests. */
  failed: number;
  /** Count of skipped tests. */
  skipped: number;
  /** Total duration in milliseconds. */
  duration: number;
}
