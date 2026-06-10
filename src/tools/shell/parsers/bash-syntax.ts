import type { Diagnostic } from "#parsers";

// bash -n writes one diagnostic per error to stderr, e.g.
//   script.sh: line 3: syntax error near unexpected token `echo'
const SYNTAX_PATTERN = /^(.+?): line (\d+): (.+)$/;

/**
 * Parse `bash -n` stderr into Diagnostic[]. bash has no column information,
 * so `column` is 0. After each error bash echoes the offending source on a
 * second `file: line N: \`…'` line; those are skipped (message starts with a
 * backtick) so each error yields a single diagnostic.
 */
export function parseBashSyntax(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const line of text.split("\n")) {
    const match = line.match(SYNTAX_PATTERN);
    if (!match) continue;

    const message = match[3] ?? "";
    if (message.startsWith("`")) continue;

    diagnostics.push({
      file: match[1] ?? "",
      line: parseInt(match[2] ?? "0", 10),
      column: 0,
      message,
      severity: "error",
    });
  }

  return diagnostics;
}
