/**
 * Output Shaping
 *
 * Trimming command output to a line/byte window — the *Shaping* of CONTEXT.md.
 * Text in, text out: no process, no I/O, so it is testable on its own and the
 * spawn layer does not depend on it.
 */

/** Which end of the output to keep when trimming. */
export type ShapeMode = "tail" | "head";

/** Controls for {@link shapeOutput}. */
export interface ShapeOptions {
  /** Keep the last N lines (tail, default) or the first N (head). */
  mode?: ShapeMode;
  /** Max lines to keep; `0`/undefined = unlimited. */
  maxLines?: number;
  /** Optional cap on the resulting byte length (UTF-8). */
  maxBytes?: number;
  /** Merge consecutive repeated lines (default true); see {@link collapseRepeats}. */
  collapse?: boolean;
}

/** Result of {@link shapeOutput}: trimmed text plus pre-trim line count. */
export interface ShapedOutput {
  text: string;
  /** Line count of the original output (before any trimming). */
  totalLines: number;
  /** True when lines and/or bytes were dropped. */
  truncated: boolean;
}

/** Leading ISO-8601 timestamp, optionally bracketed: `2026-10-23T12:00:01.5Z `. */
const LEADING_TIMESTAMP =
  /^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s*/;

/** A line's identity for repeat detection: the line minus its leading timestamp. */
export const lineKey = (line: string): string =>
  line.replace(LEADING_TIMESTAMP, "");

/** Marks the first line of a merged run with its size: `text [×N]`. */
export const markRepeat = (line: string, n: number): string =>
  `${line} [×${n}]`;

/**
 * Merge each run of consecutive items with the same non-blank key into its
 * first item, marked with the run's size. Only adjacent repeats merge, so the
 * order of events survives; blank keys never merge, so spacing survives.
 */
export function collapseRepeats<T>(
  items: T[],
  key: (item: T) => string,
  mark: (item: T, n: number) => T,
): T[] {
  const out: T[] = [];
  let runKey: string | undefined;
  let n = 0;
  const flush = () => {
    const first = out.pop();
    if (first !== undefined) out.push(n > 1 ? mark(first, n) : first);
  };
  for (const item of items) {
    const k = key(item);
    if (k.trim() !== "" && k === runKey) {
      n++;
      continue;
    }
    if (n > 0) flush();
    out.push(item);
    runKey = k;
    n = 1;
  }
  if (n > 0) flush();
  return out;
}

/**
 * Trim command output to a line and/or byte budget. Shared by `run`, `run_seq`
 * and `bash_test` so the tail/head logic lives in one place. A trailing empty
 * line from the final newline is always dropped before counting (output usually
 * ends with `\n`). Consecutive repeats are merged before the line cap, so the
 * kept window holds more distinct lines; `totalLines` counts the original output.
 * When lines are dropped a `... (N lines truncated) ...` marker
 * is inserted on the trimmed side.
 */
export function shapeOutput(
  raw: string,
  opts: ShapeOptions = {},
): ShapedOutput {
  const { mode = "tail", maxLines, maxBytes, collapse = true } = opts;

  const split = raw.split("\n");
  // Drop the trailing empty element from a final newline before counting.
  if (split.length > 0 && split[split.length - 1] === "") split.pop();
  const totalLines = split.length;
  const lines = collapse ? collapseRepeats(split, lineKey, markRepeat) : split;

  let truncated = false;
  let kept = lines;
  if (maxLines !== undefined && maxLines > 0 && lines.length > maxLines) {
    truncated = true;
    kept = mode === "head" ? lines.slice(0, maxLines) : lines.slice(-maxLines);
  }

  const omitted = lines.length - kept.length;
  const marker = `... (${omitted} lines truncated) ...`;
  let text = kept.join("\n");
  if (omitted > 0) {
    text = mode === "head" ? `${text}\n${marker}` : `${marker}\n${text}`;
  }

  // Byte cap applies after line shaping, trimming from the same end.
  if (maxBytes !== undefined && maxBytes > 0) {
    const buf = Buffer.from(text, "utf8");
    if (buf.byteLength > maxBytes) {
      truncated = true;
      const sliced =
        mode === "head"
          ? buf.subarray(0, maxBytes)
          : buf.subarray(buf.byteLength - maxBytes);
      text = sliced.toString("utf8");
    }
  }

  return { text, totalLines, truncated };
}
