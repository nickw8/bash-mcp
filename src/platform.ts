/**
 * Platform Differences
 *
 * The one place that answers "how does this repo handle BSD vs GNU". Coreutils
 * on macOS and Linux take different flags for the same information, and a
 * per-call-site ternary is how a parser ends up written against one platform's
 * output and quietly wrong on the other.
 */

export const IS_MACOS = process.platform === "darwin";

/** A field `stat` can report. */
export type StatField = "size" | "mtime" | "name";

/** Per-field format specifier: [BSD, GNU]. */
const STAT_SPEC: Record<StatField, [string, string]> = {
  size: ["%z", "%s"],
  mtime: ["%m", "%Y"],
  name: ["%N", "%n"],
};

/**
 * Build `stat` args reporting `fields` (space-separated, in order) for each
 * path. BSD takes `-f <format>`, GNU takes `--format=<format>`.
 *
 * ```
 * statArgs(["size", "mtime"], [path])
 *   → ["-f", "%z %m", path]      (BSD)
 *   → ["--format=%s %Y", path]   (GNU)
 * ```
 */
export function statArgs(fields: StatField[], paths: string[]): string[] {
  const format = fields.map((f) => STAT_SPEC[f][IS_MACOS ? 0 : 1]).join(" ");
  return IS_MACOS ? ["-f", format, ...paths] : [`--format=${format}`, ...paths];
}

/**
 * `ls` flags pinning one column layout on both platforms:
 * `perms links owner group size YYYY-MM-DD HH:MM name`. Without them BSD ls
 * emits `Aug  3 13:12` (an extra column) and swaps the time for a year on files
 * older than six months — three layouts for one parser to guess at.
 */
export const lsTimeArgs: string[] = IS_MACOS
  ? ["-D", "%Y-%m-%d %H:%M"]
  : ["--time-style=iso"];
