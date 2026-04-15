import type { ExtractResult } from "./types.js";

/** Extract outline from Markdown files (headings only). */
export function extractMarkdown(lines: string[]): ExtractResult {
  const result: string[] = [];
  let symbols = 0;

  for (const line of lines) {
    if (line.trim().startsWith("#")) {
      result.push(line);
      symbols++;
    }
  }

  return { outline: result, symbols };
}
