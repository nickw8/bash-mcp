import type { ExtractResult } from "./types.js";
import { truncate } from "./types.js";

/**
 * C# outline extractor.
 *
 * Captures using directives, namespaces, type declarations (class, struct,
 * interface, enum, record), method/constructor signatures, properties,
 * const/readonly fields, and preceding attributes/XML-doc comments.
 *
 * Unlike TypeScript/JS, C# nests everything inside namespace/class blocks,
 * so this extractor matches patterns at any indentation level.
 */
export function extractCSharp(lines: string[]): ExtractResult {
  const result: string[] = [];
  let symbols = 0;
  let inHeader = true;
  let inBlockComment = false;
  let attrBuf: string[] = [];
  let sigBuf: string | null = null;
  let parenDepth = 0;

  for (const line of lines) {
    const t = line.trim();

    // --- Block comments ---
    if (inBlockComment) {
      if (inHeader) result.push(line);
      if (t.includes("*/")) inBlockComment = false;
      continue;
    }
    if (t.startsWith("/*")) {
      if (inHeader) result.push(line);
      if (!t.includes("*/")) inBlockComment = true;
      continue;
    }

    // --- Multi-line signature continuation ---
    if (sigBuf !== null) {
      sigBuf += ` ${t}`;
      parenDepth +=
        (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
      if (parenDepth <= 0) {
        const display = sigBuf.replace(/\s*\{.*$/, "").trimEnd();
        result.push(truncate(display, 150));
        symbols++;
        sigBuf = null;
        parenDepth = 0;
      }
      continue;
    }

    // --- Header comments ---
    if (inHeader) {
      if (
        t === "" ||
        t.startsWith("//") ||
        t.startsWith("*") ||
        t.startsWith("#")
      ) {
        result.push(line);
        continue;
      }
      inHeader = false;
    }

    // Skip blanks, lone braces
    if (t === "" || t === "{" || t === "}" || t === "};") {
      attrBuf = [];
      continue;
    }

    // Skip regular comments (but buffer XML doc comments ///)
    if (t.startsWith("///")) {
      attrBuf.push(line);
      continue;
    }
    if (t.startsWith("//")) {
      continue;
    }

    // --- using directives ---
    // Match `using X;`, `using static X;`, `global using X;` but not `using var` or `using (` (disposal)
    if (
      /^(?:global\s+)?using\s+/.test(t) &&
      t.endsWith(";") &&
      !/^using\s+var\b/.test(t) &&
      !/^using\s*\(/.test(t)
    ) {
      result.push(line);
      attrBuf = [];
      continue;
    }

    // --- namespace ---
    if (/^namespace\s+/.test(t)) {
      if (result.length > 0) result.push("");
      result.push(...attrBuf);
      result.push(line.replace(/\s*\{.*$/, "").trimEnd());
      symbols++;
      attrBuf = [];
      continue;
    }

    // --- Attributes [...] ---
    if (/^\[[\w]/.test(t)) {
      attrBuf.push(line);
      continue;
    }

    // --- Type declarations: class, struct, interface, enum, record ---
    if (hasTypeKeyword(t)) {
      if (result.length > 0) result.push("");
      result.push(...attrBuf);
      result.push(truncate(line.replace(/\s*\{.*$/, "").trimEnd(), 120));
      symbols++;
      attrBuf = [];
      continue;
    }

    // --- Members that start with access/member modifiers ---
    if (hasModifier(t)) {
      // Property: `Type Name { get; set; }` or expression-bodied `Type Name =>`
      if (/\w\s*\{\s*(?:get|set|init)/.test(t)) {
        result.push(...attrBuf);
        result.push(truncate(line.trimEnd(), 120));
        symbols++;
        attrBuf = [];
        continue;
      }

      // Const / readonly field
      if (/\b(?:const|readonly)\b/.test(t) && t.endsWith(";")) {
        result.push(...attrBuf);
        result.push(truncate(line.trimEnd(), 120));
        attrBuf = [];
        continue;
      }

      // Method / constructor: has identifier followed by ( or <(
      // Exclude field assignments like `private readonly X _y = new Foo();`
      if (/\w+\s*(?:<[^>]*>)?\s*\(/.test(t) && !/=\s*new\b/.test(t)) {
        const opens = (t.match(/\(/g) || []).length;
        const closes = (t.match(/\)/g) || []).length;

        if (opens > closes) {
          // Multi-line signature — start buffering
          result.push(...attrBuf);
          sigBuf = line.trimEnd();
          parenDepth = opens - closes;
          attrBuf = [];
          continue;
        }

        // Single-line signature
        result.push(...attrBuf);
        result.push(truncate(line.replace(/\s*\{.*$/, "").trimEnd(), 150));
        symbols++;
        attrBuf = [];
        continue;
      }
    }

    attrBuf = [];
  }

  return { outline: result, symbols };
}

/** Check if a trimmed line is a type declaration (keyword must follow start-of-line or modifiers). */
function hasTypeKeyword(t: string): boolean {
  return /^(?:(?:public|private|protected|internal|static|abstract|sealed|partial|new|unsafe)\s+)*(?:class|struct|interface|enum|record)\s+\w/.test(
    t,
  );
}

/** Check if a trimmed line starts with C# access/member modifiers. */
function hasModifier(t: string): boolean {
  return /^(?:(?:public|private|protected|internal|static|abstract|virtual|override|sealed|partial|async|readonly|new|extern|unsafe|volatile|const)\s+)+/.test(
    t,
  );
}
