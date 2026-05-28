import { parseDiagnosticLines } from "../../../parsers/diagnostic-line.js";

const TSC_PATTERN =
  /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

/**
 * Parse tsc/tsgo text output into structured diagnostics.
 *
 * When run with `--pretty false`, tsc outputs lines like:
 *   src/file.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
 */
export function parseTscOutput(text: string) {
  return parseDiagnosticLines(text, TSC_PATTERN);
}
