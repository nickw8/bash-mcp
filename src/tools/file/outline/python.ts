import type { ExtractResult } from "./types.js";
import { truncate } from "./types.js";

/** Extract outline from Python files (classes, functions, imports, constants, docstrings). */
export function extractPython(lines: string[]): ExtractResult {
  const result: string[] = [];
  let symbols = 0;
  let inHeader = true;
  let commentBuf: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const t = line.trim();
    const indent = line.length - line.trimStart().length;

    // Shebang
    if (i === 0 && t.startsWith("#!")) {
      result.push(line);
      continue;
    }

    // Header block: comments + module docstring
    if (inHeader) {
      if (t === "" || t.startsWith("#")) {
        result.push(line);
        continue;
      }
      if (t.startsWith('"""') || t.startsWith("'''")) {
        i = collectDocstring(lines, i, result);
        inHeader = false;
        continue;
      }
      inHeader = false;
    }

    // Buffer comments and decorators preceding definitions
    if (t.startsWith("#") || t.startsWith("@")) {
      commentBuf.push(line);
      continue;
    }
    if (t === "") {
      commentBuf = [];
      continue;
    }

    // Imports
    if (/^(import |from \S+ import )/.test(t)) {
      result.push(line);
      commentBuf = [];
      continue;
    }

    // Class definition
    if (/^class\s+/.test(t)) {
      result.push(...commentBuf);
      result.push(line);
      symbols++;
      commentBuf = [];
      i = collectDocstring(lines, i, result);
      continue;
    }

    // Function/method definition (any indentation level)
    if (/^\s*(async\s+)?def\s+/.test(line)) {
      result.push(...commentBuf);
      result.push(line);
      symbols++;
      commentBuf = [];
      i = collectDocstring(lines, i, result);
      continue;
    }

    // Top-level constants
    if (indent === 0 && /^[A-Z_][A-Z0-9_]*\s*=/.test(t)) {
      result.push(...commentBuf);
      result.push(truncate(t, 80));
      commentBuf = [];
      continue;
    }

    commentBuf = [];
  }

  return { outline: result, symbols };
}

/** Collect a docstring on the line after index i. Returns the new index. */
function collectDocstring(
  lines: string[],
  i: number,
  result: string[],
): number {
  const nextLine = lines[i + 1];
  if (nextLine === undefined) return i;
  const next = nextLine.trim();
  if (!next.startsWith('"""') && !next.startsWith("'''")) return i;

  const q = next.substring(0, 3);
  i++;
  result.push(nextLine);

  // Single-line docstring: """text"""
  if (next.endsWith(q) && next.length > 3) return i;

  // Multi-line: find closing delimiter
  while (++i < lines.length) {
    const l = lines[i] ?? "";
    result.push(l);
    if (l.trim().endsWith(q)) break;
  }
  return i;
}
