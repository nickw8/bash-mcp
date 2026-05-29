import type { Diagnostic } from "#parsers";

// file.py:10:5: error: Incompatible types  [assignment]
const MYPY_PATTERN =
  /^(.+?):(\d+):(\d+): (error|warning|note): (.+?)(?:\s{2}\[(.+)\])?$/;

const SEVERITY_MAP: Record<string, Diagnostic["severity"]> = {
  error: "error",
  warning: "warning",
  note: "info",
};

export function parseMypyOutput(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const line of text.split("\n")) {
    const match = line.match(MYPY_PATTERN);
    if (!match) continue;

    diagnostics.push({
      file: match[1] ?? "",
      line: parseInt(match[2] ?? "0", 10),
      column: parseInt(match[3] ?? "0", 10),
      severity: SEVERITY_MAP[match[4] ?? "error"] ?? "error",
      rule: match[6] || undefined,
      message: match[5] ?? "",
    });
  }

  return diagnostics;
}
