/**
 * MSBuild output parser.
 *
 * Extracts structured diagnostics from `dotnet build` console output. MSBuild
 * emits errors and warnings in the format:
 *
 *   /full/path/File.cs(12,5): error CS0618: 'Foo' is obsolete
 *
 * This parser captures file, line, column, severity, error code, and message,
 * then strips the common path prefix so file paths are relative and compact.
 */

import type { Diagnostic } from "#parsers";

/** Regex matching MSBuild diagnostic lines: path(line,col): severity code: message */
const DIAG_PATTERN =
  /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(\w+\d+):\s+(.+)$/;

/** Max length for diagnostic messages before truncation. */
const MAX_MESSAGE_LENGTH = 200;

/**
 * Parse MSBuild console output into structured diagnostics.
 *
 * Strips the longest common path prefix from file paths so output uses
 * relative paths (e.g. `src/Foo.cs` instead of `/home/user/project/src/Foo.cs`).
 * Messages longer than 200 chars are truncated — MSBuild sometimes embeds
 * full type signatures in error messages.
 */
export function parseMSBuildOutput(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const line of text.split("\n")) {
    const match = line.match(DIAG_PATTERN);
    if (!match) continue;

    diagnostics.push({
      file: match[1] ?? "",
      line: parseInt(match[2] ?? "0", 10),
      column: parseInt(match[3] ?? "0", 10),
      severity: (match[4] as "error" | "warning") ?? "error",
      rule: match[5],
      message: truncateMessage(match[6] ?? ""),
    });
  }

  stripCommonPrefix(diagnostics);
  return diagnostics;
}

/** Truncate message to MAX_MESSAGE_LENGTH, appending ellipsis if needed. */
function truncateMessage(msg: string): string {
  if (msg.length <= MAX_MESSAGE_LENGTH) return msg;
  return `${msg.slice(0, MAX_MESSAGE_LENGTH)}…`;
}

/**
 * Strip the longest common directory prefix from all file paths in-place.
 * Turns absolute paths into relative ones for compact output.
 */
function stripCommonPrefix(diagnostics: Diagnostic[]): void {
  if (diagnostics.length === 0) return;

  const paths = diagnostics.map((d) => d.file);
  const segments = paths[0]!.split("/");
  let prefixLen = 0;

  for (let i = 0; i < segments.length - 1; i++) {
    const candidate = `${segments.slice(0, i + 1).join("/")}/`;
    if (paths.every((p) => p.startsWith(candidate))) {
      prefixLen = candidate.length;
    } else {
      break;
    }
  }

  if (prefixLen > 0) {
    for (const d of diagnostics) {
      d.file = d.file.slice(prefixLen);
    }
  }
}
