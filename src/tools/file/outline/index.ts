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

import type { Language, ExtractResult } from "./types.js";
import { extractBash } from "./bash.js";
import { extractPython } from "./python.js";
import { extractTsJs } from "./typescript.js";
import { extractSql } from "./sql.js";
import { extractYaml } from "./yaml.js";
import { extractMarkdown } from "./markdown.js";
import { extractGeneric } from "./generic.js";

export type { Language, ExtractResult };

const EXT_MAP: Record<string, Language> = {
  sh: "bash", bash: "bash", zsh: "bash",
  py: "python",
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript",
  sql: "sql",
  yml: "yaml", yaml: "yaml",
  md: "markdown", mdx: "markdown",
};

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
