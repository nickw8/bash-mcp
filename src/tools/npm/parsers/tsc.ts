import type { Diagnostic } from "./types.js";

/**
 * Parse tsc/tsgo text output into structured diagnostics.
 *
 * When run with `--pretty false`, tsc outputs lines like:
 *   src/file.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
 */
export function parseTscOutput(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

  for (const line of text.split("\n")) {
    const match = line.match(pattern);
    if (!match) continue;

    diagnostics.push({
      file: match[1] ?? "",
      line: parseInt(match[2] ?? "0", 10),
      column: parseInt(match[3] ?? "0", 10),
      message: match[6] ?? "",
      severity: (match[4] as "error" | "warning") ?? "error",
      rule: match[5],
    });
  }

  return diagnostics;
}
