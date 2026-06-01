/**
 * Tests for parseRgJson — the pure ripgrep --json stream parser.
 */
import { describe, expect, it } from "vitest";
import { parseRgJson } from "./parse.js";

/** Build one rg `match` JSON line. */
function matchLine(
  file: string,
  lineNo: number,
  text: string,
  subs: { start: number; end: number; replacement?: string }[],
): string {
  return JSON.stringify({
    type: "match",
    data: {
      path: { text: file },
      line_number: lineNo,
      lines: { text: `${text}\n` },
      submatches: subs.map((s) => ({
        match: { text: text.slice(s.start, s.end) },
        ...(s.replacement ? { replacement: { text: s.replacement } } : {}),
        start: s.start,
        end: s.end,
      })),
    },
  });
}

function contextLine(file: string, lineNo: number, text: string): string {
  return JSON.stringify({
    type: "context",
    data: {
      path: { text: file },
      line_number: lineNo,
      lines: { text: `${text}\n` },
    },
  });
}

const base = { limit: 100, extract: false, maxLen: 0 } as const;

describe("parseRgJson", () => {
  it("returns one entry per matching line, trimmed, in whole-line mode", () => {
    const stdout = [
      matchLine("a.ts", 12, "  const token = get();", [{ start: 8, end: 13 }]),
      matchLine("b.ts", 4, "useToken(token)", [{ start: 9, end: 14 }]),
    ].join("\n");

    const { entries, matchCount, fileCount } = parseRgJson(stdout, base);

    expect(matchCount).toBe(2);
    expect(fileCount).toBe(2);
    expect(entries).toEqual([
      { file: "a.ts", line: 12, text: "const token = get();", kind: "match" },
      { file: "b.ts", line: 4, text: "useToken(token)", kind: "match" },
    ]);
  });

  it("extract mode emits one entry per submatch (multi-match per line)", () => {
    const stdout = matchLine("a.ts", 1, "getToken(); validateToken();", [
      { start: 0, end: 8 }, // getToken
      { start: 12, end: 25 }, // validateToken
    ]);

    const { entries, matchCount } = parseRgJson(stdout, {
      ...base,
      extract: true,
    });

    expect(matchCount).toBe(2);
    expect(entries.map((e) => e.text)).toEqual(["getToken", "validateToken"]);
    expect(entries.every((e) => e.line === 1)).toBe(true);
  });

  it("extract + replace returns capture-group rewrites", () => {
    const stdout = matchLine("v.ts", 3, 'version "1.2.3"', [
      { start: 9, end: 14, replacement: "1.2.3" },
    ]);

    const { entries } = parseRgJson(stdout, {
      ...base,
      extract: true,
      replace: "$1",
    });

    expect(entries).toEqual([
      { file: "v.ts", line: 3, text: "1.2.3", kind: "match" },
    ]);
  });

  it("enforces the global limit across files (whole-line)", () => {
    const stdout = [
      matchLine("a.ts", 1, "x", [{ start: 0, end: 1 }]),
      matchLine("a.ts", 2, "x", [{ start: 0, end: 1 }]),
      matchLine("b.ts", 1, "x", [{ start: 0, end: 1 }]),
    ].join("\n");

    const { entries, matchCount } = parseRgJson(stdout, { ...base, limit: 2 });

    expect(matchCount).toBe(2);
    expect(entries).toHaveLength(2);
  });

  it("enforces the global limit across submatches in extract mode", () => {
    const stdout = matchLine("a.ts", 1, "aaa", [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ]);

    const { entries, matchCount } = parseRgJson(stdout, {
      ...base,
      extract: true,
      limit: 2,
    });

    expect(matchCount).toBe(2);
    expect(entries).toHaveLength(2);
  });

  it("emits context lines when context requested, skips them in extract mode", () => {
    const stdout = [
      contextLine("a.ts", 11, "before"),
      matchLine("a.ts", 12, "hit", [{ start: 0, end: 3 }]),
    ].join("\n");

    const withCtx = parseRgJson(stdout, { ...base, context: 1 });
    expect(withCtx.entries.map((e) => e.kind)).toEqual(["context", "match"]);

    const extracted = parseRgJson(stdout, {
      ...base,
      extract: true,
      context: 1,
    });
    expect(extracted.entries.every((e) => e.kind === "match")).toBe(true);
  });

  it("skips malformed JSON lines", () => {
    const stdout = [
      "not json",
      matchLine("a.ts", 1, "hit", [{ start: 0, end: 3 }]),
      "{bad",
    ].join("\n");

    const { matchCount } = parseRgJson(stdout, base);
    expect(matchCount).toBe(1);
  });
});
