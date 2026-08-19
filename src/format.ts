/**
 * Output Format Helpers
 *
 * Serializes arrays of same-shape records into compact text formats for the
 * MCP text block. JSON is the default; TSV, columnar, bare, and grouped are
 * alternatives that eliminate repeated key names.
 *
 * These formats shape `content[0].text` only. A client that reads
 * `structuredContent` — Claude Code does — never sees them, so they are not a
 * token control; shrink the payload instead (ADR-0009).
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
 * Strings this long (in bytes) are reported as a size instead of inlined.
 *
 * Set above path length on purpose: a path, ref, or one-line message is a
 * locator the reader wants, while file content, a diff, or a log body is the
 * thing we refuse to ship twice. Any string containing a newline is content by
 * that same test, whatever its length.
 */
const INLINE_STRING_LIMIT = 120;

/** Hard ceiling on a summary line, so a wide payload can't grow one unbounded. */
const SUMMARY_LIMIT = 300;

/**
 * Render a payload as a one-line summary for the MCP text block.
 *
 * `ok()` used to put `JSON.stringify(structuredContent)` here, so every response
 * shipped its payload twice — the second copy re-escaped inside a JSON string.
 * Claude Code reads `structuredContent` (ADR-0009), so that copy bought nothing
 * and correlated with the client rejecting the model's *next* call as malformed.
 * The summary keeps the block useful for a human reading a transcript without
 * repeating a byte of content.
 *
 * Scalars inline, arrays as `key[n]`, nested objects as `key{n}`, long or
 * multi-line strings as `key=<bytes>B`. Low-signal values (`false`, `null`,
 * `undefined`, `""`) are dropped, matching `metaLines` above — an empty result
 * returns `""`, which `defineTool` renders as the tool name.
 */
export function summarize(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    const part = summarizeField(key, value);
    if (part !== undefined) parts.push(part);
  }
  const line = parts.join(" ");
  return line.length > SUMMARY_LIMIT
    ? `${line.slice(0, SUMMARY_LIMIT - 1)}…`
    : line;
}

function summarizeField(key: string, value: unknown): string | undefined {
  if (
    value === undefined ||
    value === null ||
    value === false ||
    value === ""
  ) {
    return undefined;
  }
  if (Array.isArray(value)) return `${key}[${value.length}]`;
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value);
    return bytes >= INLINE_STRING_LIMIT || value.includes("\n")
      ? `${key}=${bytes}B`
      : `${key}=${value}`;
  }
  if (typeof value === "object") {
    return `${key}{${Object.keys(value).length}}`;
  }
  return `${key}=${String(value)}`;
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
