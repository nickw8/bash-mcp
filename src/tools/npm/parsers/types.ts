/** A single diagnostic (lint error, type error, etc.) with source location. */
export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning" | "info";
  rule?: string;
}

/** Result of a single test case. */
export interface TestResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  duration: number;
  failureMessage?: string;
}

/** Results for a single test file/suite. */
export interface TestSuite {
  file: string;
  tests: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}
