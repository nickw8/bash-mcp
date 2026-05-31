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

import { parseDiagnosticLines } from "../../../parsers/diagnostic-line.js";
import { stripCommonPrefix } from "../../../parsers/strip-prefix.js";

/** Regex matching MSBuild diagnostic lines: path(line,col): severity code: message */
const DIAG_PATTERN =
  /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(\w+\d+):\s+(.+)$/;

/** Max length for diagnostic messages before truncation. */
const MAX_MESSAGE_LENGTH = 200;

/**
 * Parse MSBuild console output into structured diagnostics.
 *
 * Strips the longest common path prefix from file paths and truncates
 * long messages (MSBuild sometimes embeds full type signatures).
 */
export function parseMSBuildOutput(text: string) {
  const diagnostics = parseDiagnosticLines(text, DIAG_PATTERN);

  for (const d of diagnostics) {
    d.message = truncateMessage(d.message);
  }

  const stripped = stripCommonPrefix(
    diagnostics.map((d) => d.file),
    "/",
  );
  diagnostics.forEach((d, i) => {
    d.file = stripped[i] ?? d.file;
  });
  return diagnostics;
}

/** Truncate message to MAX_MESSAGE_LENGTH, appending ellipsis if needed. */
function truncateMessage(msg: string): string {
  if (msg.length <= MAX_MESSAGE_LENGTH) return msg;
  return `${msg.slice(0, MAX_MESSAGE_LENGTH)}…`;
}
