import type { Diagnostic } from "#parsers";

/** A single shellcheck finding from `-f json1` (or legacy `-f json`). */
interface ShellcheckComment {
  file?: string;
  line?: number;
  column?: number;
  level?: string;
  code?: number;
  message?: string;
}

// shellcheck levels: error | warning | info | style. Map style → info.
function mapSeverity(level: string | undefined): Diagnostic["severity"] {
  if (level === "error") return "error";
  if (level === "warning") return "warning";
  return "info";
}

/**
 * Parse shellcheck JSON into Diagnostic[]. Accepts both output shapes:
 *   - `-f json1` → `{ "comments": [ … ] }`
 *   - `-f json`  → `[ … ]`
 * Returns [] on empty or unparseable input (e.g. a clean run, or a
 * non-JSON error string).
 */
export function parseShellcheckDiagnostics(raw: string): Diagnostic[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const comments: unknown = Array.isArray(parsed)
    ? parsed
    : (parsed as { comments?: unknown })?.comments;
  if (!Array.isArray(comments)) return [];

  return comments
    .filter((c): c is ShellcheckComment => c != null && typeof c === "object")
    .map((c) => ({
      file: c.file ?? "",
      line: c.line ?? 0,
      column: c.column ?? 0,
      message: c.message ?? "",
      severity: mapSeverity(c.level),
      rule: c.code != null ? `SC${c.code}` : undefined,
    }));
}
