/**
 * Output Format Helpers
 *
 * Serializes arrays of same-shape records into compact text formats
 * optimized for LLM token consumption. JSON is the default; TSV and
 * columnar are alternatives that eliminate repeated key names.
 */

export type ListFormat = "json" | "tsv" | "columnar";

type Row = Record<string, unknown>;

/**
 * Format a list of same-shape objects plus optional scalar metadata.
 *
 * - json:     standard JSON (default, most compatible)
 * - tsv:      header row + tab-separated values, metadata as key=value prefix
 * - columnar: JSON with keys listed once in "cols", values as positional arrays
 */
export function formatList(
  rows: Row[],
  format: ListFormat,
  meta?: Record<string, unknown>,
): string {
  switch (format) {
    case "tsv":
      return formatTsv(rows, meta);
    case "columnar":
      return formatColumnar(rows, meta);
    default:
      return formatJson(rows, meta);
  }
}

function formatJson(rows: Row[], meta?: Record<string, unknown>): string {
  return JSON.stringify(meta ? { ...meta, rows } : rows);
}

function formatTsv(rows: Row[], meta?: Record<string, unknown>): string {
  const parts: string[] = [];

  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      parts.push(`${k}\t${v}`);
    }
    parts.push("---");
  }

  if (rows.length > 0) {
    const keys = Object.keys(rows[0]!);
    parts.push(keys.join("\t"));
    for (const row of rows) {
      parts.push(keys.map((k) => escape(row[k])).join("\t"));
    }
  }

  return parts.join("\n");
}

function formatColumnar(rows: Row[], meta?: Record<string, unknown>): string {
  if (rows.length === 0) {
    return JSON.stringify(meta ?? {});
  }
  const cols = Object.keys(rows[0]!);
  const data = rows.map((r) => cols.map((k) => r[k]));
  return JSON.stringify({ ...(meta ?? {}), cols, data });
}

/** Escape a cell value for TSV (replace tabs and newlines). */
function escape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.replace(/\t/g, " ").replace(/\n/g, "\\n").replace(/\r/g, "");
}
