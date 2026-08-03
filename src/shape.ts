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
}

/** Result of {@link shapeOutput}: trimmed text plus pre-trim line count. */
export interface ShapedOutput {
  text: string;
  /** Line count of the original output (before any trimming). */
  totalLines: number;
  /** True when lines and/or bytes were dropped. */
  truncated: boolean;
}

/**
 * Trim command output to a line and/or byte budget. Shared by `run`, `run_seq`
 * and `bash_test` so the tail/head logic lives in one place. A trailing empty
 * line from the final newline is always dropped before counting (output usually
 * ends with `\n`). When lines are dropped a `... (N lines truncated) ...` marker
 * is inserted on the trimmed side.
 */
export function shapeOutput(
  raw: string,
  opts: ShapeOptions = {},
): ShapedOutput {
  const { mode = "tail", maxLines, maxBytes } = opts;

  const lines = raw.split("\n");
  // Drop the trailing empty element from a final newline before counting.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const totalLines = lines.length;

  let truncated = false;
  let kept = lines;
  if (maxLines !== undefined && maxLines > 0 && totalLines > maxLines) {
    truncated = true;
    kept = mode === "head" ? lines.slice(0, maxLines) : lines.slice(-maxLines);
  }

  const omitted = totalLines - kept.length;
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
