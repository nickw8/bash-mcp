/**
 * JSON-ish output parser for tools that emit JSON (jq, yq).
 *
 * Handles three cases: single JSON value, multiple JSON values (one per line),
 * and raw string output (e.g. jq -r or yq in yaml/props mode).
 */

export type JsonParseResult =
  | { kind: "single"; value: unknown }
  | { kind: "multi"; values: unknown[] }
  | { kind: "raw"; text: string };

export function parseJsonishOutput(stdout: string): JsonParseResult {
  const trimmed = stdout.trim();

  try {
    return { kind: "single", value: JSON.parse(trimmed) };
  } catch {
    // May be multiple JSON values, one per line
  }

  const lines = trimmed.split("\n").filter(Boolean);
  const values: unknown[] = [];

  for (const line of lines) {
    try {
      values.push(JSON.parse(line));
    } catch {
      return { kind: "raw", text: trimmed };
    }
  }

  if (values.length > 0) {
    return { kind: "multi", values };
  }

  return { kind: "raw", text: trimmed };
}
