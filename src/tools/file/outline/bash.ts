import type { ExtractResult } from "./types.js";
import { truncate } from "./types.js";

/** Extract outline from bash/shell scripts (functions, constants, source directives). */
export function extractBash(lines: string[]): ExtractResult {
  const result: string[] = [];
  let symbols = 0;
  let inHeader = true;
  let commentBuf: string[] = [];

  for (const line of lines) {
    const t = line.trim();

    // Shebang
    if (t.startsWith("#!")) {
      result.push(line);
      continue;
    }

    // Header comment block (before first code)
    if (inHeader) {
      if (t === "" || t.startsWith("#")) {
        result.push(line);
        continue;
      }
      inHeader = false;
    }

    // Buffer comments preceding definitions
    if (t.startsWith("#")) {
      commentBuf.push(line);
      continue;
    }
    if (t === "") {
      commentBuf = [];
      continue;
    }

    // source / dot-source
    if (/^(source|\.) /.test(t)) {
      commentBuf = [];
      result.push(line);
      continue;
    }

    // Function definition: name() { ... }
    const fnMatch = t.match(/^([a-zA-Z_]\w*)\s*\(\)/);
    if (fnMatch) {
      result.push(...commentBuf);
      result.push(`${fnMatch[1]}()`);
      symbols++;
      commentBuf = [];
      continue;
    }

    // Top-level uppercase assignments (constants, arrays)
    if (/^[A-Z_][A-Z0-9_]*[=(]/.test(t)) {
      result.push(...commentBuf);
      result.push(
        t.includes("=(") ? t.replace(/=\([\s\S]*/, "=(...)") : truncate(t, 80),
      );
      commentBuf = [];
      continue;
    }

    // main "$@" entry point
    if (/^main\b/.test(t)) {
      result.push(line);
      continue;
    }

    commentBuf = [];
  }

  return { outline: result, symbols };
}
