import type { ExtractResult } from "./types.js";
import { truncate } from "./types.js";

/** Covers both TypeScript and JavaScript. */
export function extractTsJs(lines: string[]): ExtractResult {
  const result: string[] = [];
  let symbols = 0;
  let inHeader = true;
  let inBlockComment = false;
  let commentBuf: string[] = [];

  for (const line of lines) {
    const t = line.trim();
    const indent = line.length - line.trimStart().length;

    // Header block: comments (single-line, block-style, or JSDoc)
    if (inHeader) {
      if (
        t === "" ||
        t.startsWith("//") ||
        t.startsWith("/*") ||
        t.startsWith("*")
      ) {
        result.push(line);
        if (t.startsWith("/*") && !t.includes("*/")) inBlockComment = true;
        if (inBlockComment && t.includes("*/")) inBlockComment = false;
        continue;
      }
      inHeader = false;
    }

    // Inside a block/JSDoc comment — buffer regardless of indent
    if (inBlockComment) {
      commentBuf.push(line);
      if (t.includes("*/")) inBlockComment = false;
      continue;
    }

    // Only show top-level declarations (indent 0)
    if (indent > 0) {
      commentBuf = [];
      continue;
    }

    // Closing braces / blank lines
    if (t === "}" || t === "") {
      commentBuf = [];
      continue;
    }

    // Buffer comments (single-line and block/JSDoc)
    if (t.startsWith("//") || t.startsWith("/*")) {
      commentBuf.push(line);
      if (t.startsWith("/*") && !t.includes("*/")) inBlockComment = true;
      continue;
    }

    // Decorators
    if (t.startsWith("@")) {
      commentBuf.push(line);
      continue;
    }

    // Imports
    if (/^import\b/.test(t)) {
      result.push(line);
      commentBuf = [];
      continue;
    }

    // Definitions: export, function, class, interface, type, enum, const/let/var
    if (
      /^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\b/.test(
        t,
      )
    ) {
      result.push(...commentBuf);
      // Strip body: remove everything after opening brace or arrow
      let display = t.replace(/\s*\{[\s\S]*$/, "");
      display = display.replace(/\s*=>\s*[\s\S]*$/, " => ...");
      result.push(truncate(display, 100));
      if (
        /^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum)\b/.test(
          t,
        )
      ) {
        symbols++;
      }
      commentBuf = [];
      continue;
    }

    commentBuf = [];
  }

  return { outline: result, symbols };
}
