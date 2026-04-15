import type { ExtractResult } from "./types.js";
import { truncate } from "./types.js";

/** Extract outline from XML files (elements, comments, declarations). */
export function extractXml(lines: string[]): ExtractResult {
  const result: string[] = [];
  let symbols = 0;

  for (const line of lines) {
    const t = line.trim();

    // Skip blank lines
    if (t === "") continue;

    // XML declaration
    if (t.startsWith("<?")) {
      result.push(truncate(line, 120));
      continue;
    }

    // Comments
    if (t.startsWith("<!--")) {
      result.push(truncate(line, 120));
      continue;
    }

    // Skip namespace/schema attributes (continuation of root element)
    if (t.startsWith("xmlns") || t.startsWith("xsi:")) continue;

    // Skip closing tags
    if (t.startsWith("</")) continue;

    // Opening element tags — capture root and first two levels of children
    const indent = line.length - line.trimStart().length;
    if (t.startsWith("<") && indent <= 8) {
      result.push(truncate(line, 120));
      const match = t.match(/^<(\w[\w:-]*)/);
      if (match) symbols++;
    }
  }

  return { outline: result, symbols };
}
