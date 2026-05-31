/**
 * Window a matched line around the match so long / minified lines don't dump in
 * full into the result. Returns the trimmed line when it's within `maxLen` (or
 * `maxLen <= 0`); otherwise a ~`maxLen`-wide slice centered on the match span
 * `[start, end)`, trimmed, with `…` marking each truncated edge.
 *
 * `start`/`end` are character offsets into the original (untrimmed) line, as
 * reported by ripgrep's submatch data — so windowing happens before trimming and
 * the offsets stay valid.
 */
export function windowMatchText(
  text: string,
  start: number,
  end: number,
  maxLen: number,
): string {
  const full = text.trim();
  if (maxLen <= 0 || full.length <= maxLen) return full;

  const matchLen = Math.max(0, end - start);
  const pad = Math.max(0, Math.floor((maxLen - matchLen) / 2));
  let from = Math.max(0, start - pad);
  let to = Math.min(text.length, end + pad);

  // If we clipped against one edge, grow the other to use the full budget.
  if (to - from < maxLen) {
    if (from === 0) to = Math.min(text.length, maxLen);
    else if (to === text.length) from = Math.max(0, text.length - maxLen);
  }

  let slice = text.slice(from, to).trim();
  if (from > 0) slice = `…${slice}`;
  if (to < text.length) slice = `${slice}…`;
  return slice;
}
