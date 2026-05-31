/**
 * Output Format Helpers
 *
 * Serializes arrays of same-shape records into compact text formats
 * optimized for LLM token consumption. JSON is the default; TSV, columnar,
 * bare, and grouped are alternatives that eliminate repeated key names.
 */

export type ListFormat = "json" | "tsv" | "columnar" | "bare" | "grouped";

type Row = Record<string, unknown>;

/**
 * Format a list of same-shape objects plus optional scalar metadata.
 *
 * - json:     standard JSON (default, most compatible)
 * - tsv:      header row + tab-separated values, metadata as key=value prefix
 * - columnar: JSON with keys listed once in "cols", values as positional arrays
 * - bare:     like tsv but with NO header row — most compact for single-column
 *             lists (paths, addresses) where the column name adds no signal
 * - grouped:  group rows by their first column; print each group value once as a
 *             "value:" header, then the remaining columns per row (ripgrep-style)
 *
 * Rows may be ragged: the column set is the union of keys across all rows, in
 * first-seen order, so tools that emit per-row optional fields stay aligned.
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
    case "grouped":
      return formatGrouped(rows, meta);
    case "columnar":
      return formatColumnar(rows, meta);
    default:
      return formatJson(rows, meta);
  }
}

/**
 * Restrict each row to the named fields (in the given order), dropping the rest.
 * Used for the `fields` projection: callers keep full `structuredContent` but emit
 * only the requested columns in the text block. A field absent from a row is
 * skipped for that row. Empty/undefined `fields` returns the rows unchanged.
 */
export function projectRows(rows: Row[], fields?: string[]): Row[] {
  if (!fields || fields.length === 0) return rows;
  return rows.map((r) =>
    Object.fromEntries(fields.filter((f) => f in r).map((f) => [f, r[f]])),
  );
}

/** Union of keys across all rows, preserving first-seen order. */
function unionKeys(rows: Row[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys;
}

/** Render one metadata line, JSON-encoding object/array values. */
function metaLine(k: string, v: unknown): string {
  return `${k}\t${v !== null && typeof v === "object" ? JSON.stringify(v) : v}`;
}

/**
 * Build the metadata prefix lines (each `key\tvalue`, then a `---` separator).
 * Low-signal default values (false, null, undefined, "") are omitted so tiny
 * results aren't dominated by boilerplate like `truncated\tfalse`. Returns []
 * when nothing meaningful remains.
 */
function metaLines(meta?: Record<string, unknown>): string[] {
  if (!meta) return [];
  const entries = Object.entries(meta).filter(
    ([, v]) => v !== false && v !== null && v !== undefined && v !== "",
  );
  if (entries.length === 0) return [];
  return [...entries.map(([k, v]) => metaLine(k, v)), "---"];
}

function formatJson(rows: Row[], meta?: Record<string, unknown>): string {
  return JSON.stringify(meta ? { ...meta, rows } : rows);
}

function formatTsv(
  rows: Row[],
  meta?: Record<string, unknown>,
  header = true,
): string {
  const parts = metaLines(meta);

  if (rows.length > 0) {
    const keys = unionKeys(rows);
    if (header) parts.push(keys.join("\t"));
    for (const row of rows) {
      parts.push(keys.map((k) => escapeCell(row[k])).join("\t"));
    }
  }

  return parts.join("\n");
}

function formatGrouped(rows: Row[], meta?: Record<string, unknown>): string {
  const parts = metaLines(meta);

  if (rows.length > 0) {
    const [groupKey, ...rest] = unionKeys(rows);
    let lastGroup: string | undefined;
    for (const row of rows) {
      const g = escapeCell(row[groupKey ?? ""]);
      if (g !== lastGroup) {
        parts.push(`${g}:`);
        lastGroup = g;
      }
      parts.push(rest.map((k) => escapeCell(row[k])).join("\t"));
    }
  }

  return parts.join("\n");
}

function formatColumnar(rows: Row[], meta?: Record<string, unknown>): string {
  const cleanMeta = meta
    ? Object.fromEntries(
        Object.entries(meta).filter(
          ([, v]) => v !== false && v !== null && v !== undefined && v !== "",
        ),
      )
    : {};
  if (rows.length === 0) {
    return JSON.stringify(cleanMeta);
  }
  const cols = unionKeys(rows);
  const data = rows.map((r) => cols.map((k) => r[k]));
  return JSON.stringify({ ...cleanMeta, cols, data });
}

/** Escape a cell value for TSV (replace tabs and newlines). */
function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.replace(/\t/g, " ").replace(/\n/g, "\\n").replace(/\r/g, "");
}
