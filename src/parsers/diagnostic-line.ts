/**
 * Generic diagnostic line parser for `path(line,col): severity code: message` format.
 *
 * Shared by MSBuild (dotnet) and tsc/tsgo (npm) parsers which both emit
 * diagnostics in this pattern but with slightly different regex capture groups.
 */

import type { Diagnostic } from "./types.js";

/**
 * Parse lines matching a diagnostic pattern into structured Diagnostics.
 *
 * The regex must have 6 capture groups in order:
 *   1: file path, 2: line, 3: column, 4: severity, 5: rule/code, 6: message
 */
export function parseDiagnosticLines(
  text: string,
  pattern: RegExp,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const line of text.split("\n")) {
    const match = line.match(pattern);
    if (!match) continue;

    diagnostics.push({
      file: match[1] ?? "",
      line: parseInt(match[2] ?? "0", 10),
      column: parseInt(match[3] ?? "0", 10),
      severity: (match[4] as "error" | "warning") ?? "error",
      rule: match[5],
      message: match[6] ?? "",
    });
  }

  return diagnostics;
}
