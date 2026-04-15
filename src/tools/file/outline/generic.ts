import type { ExtractResult } from "./types.js";
import { truncate } from "./types.js";

/** Fallback extractor for unrecognized file types. */
export function extractGeneric(lines: string[]): ExtractResult {
  const result: string[] = [];
  let symbols = 0;
  let inHeader = true;

  for (const line of lines) {
    const t = line.trim();
    const indent = line.length - line.trimStart().length;

    // Header comments (any common comment style)
    if (inHeader) {
      if (t === "" || /^(#|\/\/|\/\*|--|;)/.test(t) || t.startsWith("*")) {
        result.push(line);
        continue;
      }
      inHeader = false;
    }

    // Top-level definition keywords (covers most C-family and scripting languages)
    if (indent === 0 && t !== "" && t !== "}") {
      if (/^(function|class|def|sub|fn|func|proc|package|module|namespace|struct|impl|trait|enum|interface|type)\b/.test(t)) {
        result.push(truncate(line, 100));
        symbols++;
      }
    }
  }

  return { outline: result, symbols };
}
