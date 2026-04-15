import type { ExtractResult } from "./types.js";

export function extractYaml(lines: string[]): ExtractResult {
  const result: string[] = [];
  let symbols = 0;

  for (const line of lines) {
    const t = line.trim();

    // Comments, blanks, document markers
    if (t.startsWith("#") || t === "" || t === "---" || t === "...") {
      result.push(line);
      continue;
    }

    // Top-level keys (no indentation)
    if (!line.startsWith(" ") && !line.startsWith("\t") && t.includes(":")) {
      result.push(line);
      symbols++;
      continue;
    }

    // Second-level keys (2-space indent)
    if (/^ {2}\S/.test(line) && t.includes(":")) {
      result.push(line);
      continue;
    }
  }

  return { outline: result, symbols };
}
