/**
 * File Outline Extraction
 *
 * Extracts structural outlines from source files using pattern matching.
 * Shows function/class names, top-level comments, imports, and constants
 * without implementation bodies. Language is detected from file extension.
 *
 * Supported languages: bash, csharp, python, typescript/javascript, sql, yaml, markdown.
 * Unknown extensions get a generic extractor (header comments + definition patterns).
 */

import { extractBash } from "./bash.js";
import { extractCSharp } from "./csharp.js";
import { extractGeneric } from "./generic.js";
import { extractMarkdown } from "./markdown.js";
import { extractPython } from "./python.js";
import { extractSql } from "./sql.js";
import type { ExtractResult, Language } from "./types.js";
import { extractTsJs } from "./typescript.js";
import { extractYaml } from "./yaml.js";

export type { ExtractResult, Language };

const EXT_MAP: Record<string, Language> = {
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  cs: "csharp",
  py: "python",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  mdx: "markdown",
};

const EXTRACTORS: Record<Language, (lines: string[]) => ExtractResult> = {
  bash: extractBash,
  csharp: extractCSharp,
  python: extractPython,
  typescript: extractTsJs,
  javascript: extractTsJs,
  sql: extractSql,
  yaml: extractYaml,
  markdown: extractMarkdown,
  unknown: extractGeneric,
};

/** Detect the source language from a file path's extension. */
export function detectLanguage(filePath: string): Language {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? "unknown";
}

/** Extract a structural outline from file content using a language-specific extractor. */
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
