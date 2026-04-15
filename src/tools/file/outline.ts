/**
 * File Outline Extraction
 *
 * Extracts structural outlines from source files using pattern matching.
 * Shows function/class names, top-level comments, imports, and constants
 * without implementation bodies. Language is detected from file extension.
 *
 * Supported languages: bash, python, typescript/javascript, sql, yaml, markdown.
 * Unknown extensions get a generic extractor (header comments + definition patterns).
 */

export type Language =
  | "bash"
  | "python"
  | "typescript"
  | "javascript"
  | "sql"
  | "yaml"
  | "markdown"
  | "unknown";

interface ExtractResult {
  outline: string[];
  symbols: number;
}

const EXT_MAP: Record<string, Language> = {
  sh: "bash", bash: "bash", zsh: "bash",
  py: "python",
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript",
  sql: "sql",
  yml: "yaml", yaml: "yaml",
  md: "markdown", mdx: "markdown",
};

export function detectLanguage(filePath: string): Language {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? "unknown";
}

export function extractOutline(
  content: string,
  language: Language,
): { language: Language; outline: string; symbols: number } {
  const lines = content.split("\n");
  // Remove trailing empty line from split
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const extractor = EXTRACTORS[language];
  const { outline, symbols } = extractor(lines);
  return { language, outline: outline.join("\n"), symbols };
}

// ---------------------------------------------------------------------------
// Language extractors
// ---------------------------------------------------------------------------

const EXTRACTORS: Record<Language, (lines: string[]) => ExtractResult> = {
  bash: extractBash,
  python: extractPython,
  typescript: extractTsJs,
  javascript: extractTsJs,
  sql: extractSql,
  yaml: extractYaml,
  markdown: extractMarkdown,
  unknown: extractGeneric,
};

// -- Bash / Shell -----------------------------------------------------------

function extractBash(lines: string[]): ExtractResult {
  const result: string[] = [];
  let symbols = 0;
  let inHeader = true;
  let commentBuf: string[] = [];

  for (const line of lines) {
    const t = line.trim();

    // Shebang
    if (t.startsWith("#!")) { result.push(line); continue; }

    // Header comment block (before first code)
    if (inHeader) {
      if (t === "" || t.startsWith("#")) { result.push(line); continue; }
      inHeader = false;
    }

    // Buffer comments preceding definitions
    if (t.startsWith("#")) { commentBuf.push(line); continue; }
    if (t === "") { commentBuf = []; continue; }

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
      result.push(t.includes("=(") ? t.replace(/=\([\s\S]*/, "=(...)") : truncate(t, 80));
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

// -- Python -----------------------------------------------------------------

function extractPython(lines: string[]): ExtractResult {
  const result: string[] = [];
  let symbols = 0;
  let inHeader = true;
  let commentBuf: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    const indent = line.length - line.trimStart().length;

    // Shebang
    if (i === 0 && t.startsWith("#!")) { result.push(line); continue; }

    // Header block: comments + module docstring
    if (inHeader) {
      if (t === "" || t.startsWith("#")) { result.push(line); continue; }
      if (t.startsWith('"""') || t.startsWith("'''")) {
        i = collectDocstring(lines, i, result);
        inHeader = false;
        continue;
      }
      inHeader = false;
    }

    // Buffer comments and decorators preceding definitions
    if (t.startsWith("#") || t.startsWith("@")) { commentBuf.push(line); continue; }
    if (t === "") { commentBuf = []; continue; }

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
function collectDocstring(lines: string[], i: number, result: string[]): number {
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
    const l = lines[i]!;
    result.push(l);
    if (l.trim().endsWith(q)) break;
  }
  return i;
}

// -- TypeScript / JavaScript ------------------------------------------------

function extractTsJs(lines: string[]): ExtractResult {
  const result: string[] = [];
  let symbols = 0;
  let inHeader = true;
  let commentBuf: string[] = [];

  for (const line of lines) {
    const t = line.trim();
    const indent = line.length - line.trimStart().length;

    // Header block: comments (single-line, block-style, or JSDoc)
    if (inHeader) {
      if (t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) {
        result.push(line);
        continue;
      }
      inHeader = false;
    }

    // Only show top-level declarations (indent 0)
    if (indent > 0) { commentBuf = []; continue; }

    // Closing braces / blank lines
    if (t === "}" || t === "") { commentBuf = []; continue; }

    // Buffer comments
    if (t.startsWith("//")) { commentBuf.push(line); continue; }

    // Decorators
    if (t.startsWith("@")) { commentBuf.push(line); continue; }

    // Imports
    if (/^import\b/.test(t)) {
      result.push(line);
      commentBuf = [];
      continue;
    }

    // Definitions: export, function, class, interface, type, enum, const/let/var
    if (/^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\b/.test(t)) {
      result.push(...commentBuf);
      // Strip body: remove everything after opening brace or arrow
      let display = t.replace(/\s*\{[\s\S]*$/, "");
      display = display.replace(/\s*=>\s*[\s\S]*$/, " => ...");
      result.push(truncate(display, 100));
      if (/^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum)\b/.test(t)) {
        symbols++;
      }
      commentBuf = [];
      continue;
    }

    commentBuf = [];
  }

  return { outline: result, symbols };
}

// -- SQL --------------------------------------------------------------------

/** Test whether a `--` comment is a Liquibase directive or structural comment
 *  (not commented-out code). */
function isSqlStructuralComment(trimmed: string): boolean {
  // Liquibase directives
  if (/^--(liquibase|changeset|precondition|comment|rollback|validCheckSum|endDelimiter|context|labels)\b/i.test(trimmed)) {
    return true;
  }
  // Section separator lines (--- or ==== or #### etc.)
  if (/^--\s*[-=*#]{3,}/.test(trimmed)) return true;
  // Short comment text (likely a human note, not dead code) — up to ~60 chars after --
  const body = trimmed.replace(/^--\s*/, "");
  if (body.length <= 60 && !/^[\[(\w]+\.\w+/.test(body)) return true;
  return false;
}

function extractSql(lines: string[]): ExtractResult {
  const result: string[] = [];
  let symbols = 0;
  let inHeader = true;
  let inBody = false;

  for (const line of lines) {
    const t = line.trim();
    const upper = t.toUpperCase();

    // Header comments (Liquibase preamble, file-level comments)
    if (inHeader) {
      if (t === "" || t.startsWith("--") || t.startsWith("/*") || t.startsWith("*")) {
        result.push(line);
        continue;
      }
      inHeader = false;
    }

    // Top-level DDL that creates a body (procedure, function, trigger, view)
    if (!inBody && /^(CREATE|ALTER)\b/i.test(t) &&
        /\b(PROCEDURE|FUNCTION|TRIGGER|VIEW)\b/i.test(t)) {
      result.push(truncate(line, 120));
      symbols++;
      // Procedures/functions/triggers have bodies — suppress internal DML
      if (!/\bVIEW\b/i.test(t)) { inBody = true; }
      continue;
    }

    // Inside a proc/function/trigger body — only emit structural markers
    if (inBody) {
      // End of body: GO on its own line (SQL Server batch separator)
      if (/^GO\s*$/i.test(t)) {
        inBody = false;
        continue;
      }
      // Liquibase rollback/changeset starts a new section
      if (/^--(changeset|rollback)\b/i.test(t)) {
        inBody = false;
        result.push(line);
        continue;
      }
      // Skip everything else inside the body
      continue;
    }

    // Outside a body — capture structural comments (not dead code)
    if (t.startsWith("--")) {
      if (isSqlStructuralComment(t)) { result.push(line); }
      continue;
    }

    // Block comments
    if (t.startsWith("/*")) { result.push(truncate(line, 100)); continue; }

    // Top-level DDL without a body (CREATE TABLE, ALTER TABLE, CREATE INDEX, DROP)
    if (/^(CREATE|ALTER|DROP)\b/i.test(t)) {
      result.push(truncate(line, 120));
      symbols++;
      continue;
    }

    // Top-level DML (only outside proc bodies)
    if (/^(INSERT|UPDATE|DELETE|MERGE|WITH|SELECT)\b/i.test(t)) {
      result.push(truncate(line, 100));
      continue;
    }
  }

  return { outline: result, symbols };
}

// -- YAML -------------------------------------------------------------------

function extractYaml(lines: string[]): ExtractResult {
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

// -- Markdown ---------------------------------------------------------------

function extractMarkdown(lines: string[]): ExtractResult {
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

// -- Generic (unknown language) ---------------------------------------------

function extractGeneric(lines: string[]): ExtractResult {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.substring(0, max - 3)}...` : s;
}
