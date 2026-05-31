/**
 * Output Format Helpers
 *
 * Serializes arrays of same-shape records into compact text formats
 * optimized for LLM token consumption. JSON is the default; TSV and
 * columnar are alternatives that eliminate repeated key names.
 */

export type ListFormat = "json" | "tsv" | "columnar" | "bare";

type Row = Record<string, unknown>;

/**
 * Format a list of same-shape objects plus optional scalar metadata.
 *
 * - json:     standard JSON (default, most compatible)
 * - tsv:      header row + tab-separated values, metadata as key=value prefix
 * - columnar: JSON with keys listed once in "cols", values as positional arrays
 * - bare:     like tsv but with NO header row — most compact for single-column
 *             lists (paths, addresses) where the column name adds no signal
 */
export function formatList(
  rows: Row[],
  format: ListFormat,
  meta?: Record<string, unknown>,
): string {
  switch (format) {
    case "tsv":
      return formatTsv(rows, meta);
    case "bare":
      return formatTsv(rows, meta, false);
    case "columnar":
      return formatColumnar(rows, meta);
    default:
      return formatJson(rows, meta);
  }
}

/** Render one metadata line, JSON-encoding object/array values. */
function metaLine(k: string, v: unknown): string {
  return `${k}\t${v !== null && typeof v === "object" ? JSON.stringify(v) : v}`;
}

function formatJson(rows: Row[], meta?: Record<string, unknown>): string {
  return JSON.stringify(meta ? { ...meta, rows } : rows);
}

function formatTsv(
  rows: Row[],
  meta?: Record<string, unknown>,
  header = true,
): string {
  const parts: string[] = [];

  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      parts.push(metaLine(k, v));
    }
    parts.push("---");
  }

  if (rows.length > 0) {
    const keys = Object.keys(rows[0] ?? {});
    if (header) parts.push(keys.join("\t"));
    for (const row of rows) {
      parts.push(keys.map((k) => escapeCell(row[k])).join("\t"));
    }
  }

  return parts.join("\n");
}

function formatColumnar(rows: Row[], meta?: Record<string, unknown>): string {
  if (rows.length === 0) {
    return JSON.stringify(meta ?? {});
  }
  const cols = Object.keys(rows[0] ?? {});
  const data = rows.map((r) => cols.map((k) => r[k]));
  return JSON.stringify({ ...(meta ?? {}), cols, data });
}

/** Escape a cell value for TSV (replace tabs and newlines). */
function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.replace(/\t/g, " ").replace(/\n/g, "\\n").replace(/\r/g, "");
}
