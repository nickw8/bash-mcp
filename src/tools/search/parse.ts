/**
 * Pure parser for ripgrep's `--json` output stream.
 *
 * Turns the line-delimited JSON rg emits into a flat list of entries (matches
 * and, when requested, context lines), applying the global result cap and the
 * extract/window shaping. Kept side-effect free so it can be fixture-tested
 * without spawning rg.
 */
import { windowMatchText } from "./window.js";

export interface RgEntry {
  file: string;
  line: number;
  text: string;
  kind: "match" | "context";
}

export interface ParseRgOptions {
  /** Global cap across all files (counts emitted match entries). */
  limit: number;
  /** Emit one entry per submatch (substring/rewrite) instead of whole lines. */
  extract: boolean;
  /** When set, prefer each submatch's capture-group rewrite text. */
  replace?: string;
  /** Whether context lines were requested (so they're emitted, not extract). */
  context?: number;
  /** Window width for whole-line match text (0 = unlimited). */
  maxLen: number;
}

export interface ParsedRg {
  entries: RgEntry[];
  /** Number of emitted match entries (submatches in extract mode, else lines). */
  matchCount: number;
  /** Distinct files that had at least one match. */
  fileCount: number;
}

interface RgSubmatch {
  start: number;
  end: number;
  match?: { text?: string };
  replacement?: { text?: string };
}

interface RgData {
  path?: { text?: string };
  line_number?: number;
  lines?: { text?: string };
  submatches?: RgSubmatch[];
}

export function parseRgJson(stdout: string, opts: ParseRgOptions): ParsedRg {
  const { limit, extract, replace, context, maxLen } = opts;
  const entries: RgEntry[] = [];
  const filesSeen = new Set<string>();
  let matchCount = 0;

  for (const line of stdout.split("\n").filter(Boolean)) {
    let msg: { type?: string; data?: RgData };
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // skip malformed lines
    }
    const data = msg.data;
    if (!data?.path?.text || data.lines?.text === undefined) continue;

    if (msg.type === "match") {
      filesSeen.add(data.path.text);
      const lineNo = data.line_number ?? 0;
      const subs = data.submatches ?? [];

      if (extract) {
        // One row per submatch — every hit on the line, matched substring
        // (or capture-group rewrite via `replace`), trimmed.
        for (const sub of subs) {
          if (matchCount >= limit) break;
          matchCount++;
          const text =
            (replace !== undefined ? sub.replacement?.text : sub.match?.text) ??
            data.lines.text.slice(sub.start, sub.end);
          entries.push({
            file: data.path.text,
            line: lineNo,
            text: text.trim(),
            kind: "match",
          });
        }
      } else {
        if (matchCount >= limit) continue;
        matchCount++;
        const sub = subs[0];
        const text = sub
          ? windowMatchText(data.lines.text, sub.start, sub.end, maxLen)
          : data.lines.text.trim();
        entries.push({
          file: data.path.text,
          line: lineNo,
          text,
          kind: "match",
        });
      }
    } else if (msg.type === "context" && context && !extract) {
      entries.push({
        file: data.path.text,
        line: data.line_number ?? 0,
        text: windowMatchText(data.lines.text, 0, 0, maxLen),
        kind: "context",
      });
    }
  }

  return { entries, matchCount, fileCount: filesSeen.size };
}

/**
 * Group flat entries into the billed payload shape: one object per file, each
 * hit encoded as `"<line>:<text>"` (`"<line>-<text>"` for a context line, the
 * grep convention). The path is paid for once per file instead of once per hit,
 * and the `line`/`text` keys disappear entirely — see ADR-0009.
 */
export function groupMatchesByFile(
  entries: RgEntry[],
  path: (file: string) => string = (f) => f,
): Array<{ file: string; lines: string[] }> {
  const byFile = new Map<string, string[]>();
  for (const e of entries) {
    const file = path(e.file);
    const sep = e.kind === "context" ? "-" : ":";
    const lines = byFile.get(file);
    if (lines) lines.push(`${e.line}${sep}${e.text}`);
    else byFile.set(file, [`${e.line}${sep}${e.text}`]);
  }
  return [...byFile].map(([file, lines]) => ({ file, lines }));
}
