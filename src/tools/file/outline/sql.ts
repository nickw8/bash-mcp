import type { ExtractResult } from "./types.js";
import { truncate } from "./types.js";

/** Test whether a `--` comment is a Liquibase directive or structural comment
 *  (not commented-out code). */
function isSqlStructuralComment(trimmed: string): boolean {
  // Liquibase directives
  if (
    /^--(liquibase|changeset|precondition|comment|rollback|validCheckSum|endDelimiter|context|labels)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  // Section separator lines (--- or ==== or #### etc.)
  if (/^--\s*[-=*#]{3,}/.test(trimmed)) return true;
  // Short comment text (likely a human note, not dead code) — up to ~60 chars after --
  const body = trimmed.replace(/^--\s*/, "");
  if (body.length <= 60 && !/^[[(\\w]+\.\w+/.test(body)) return true;
  return false;
}

/** Extract outline from SQL files (DDL, DML, Liquibase directives, structural comments). */
export function extractSql(lines: string[]): ExtractResult {
  const result: string[] = [];
  let symbols = 0;
  let inHeader = true;
  let inBody = false;

  for (const line of lines) {
    const t = line.trim();
    const _upper = t.toUpperCase();

    // Header comments (Liquibase preamble, file-level comments)
    if (inHeader) {
      if (
        t === "" ||
        t.startsWith("--") ||
        t.startsWith("/*") ||
        t.startsWith("*")
      ) {
        result.push(line);
        continue;
      }
      inHeader = false;
    }

    // Top-level DDL that creates a body (procedure, function, trigger, view)
    if (
      !inBody &&
      /^(CREATE|ALTER)\b/i.test(t) &&
      /\b(PROCEDURE|FUNCTION|TRIGGER|VIEW)\b/i.test(t)
    ) {
      result.push(truncate(line, 120));
      symbols++;
      // Procedures/functions/triggers have bodies — suppress internal DML
      if (!/\bVIEW\b/i.test(t)) {
        inBody = true;
      }
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
      if (isSqlStructuralComment(t)) {
        result.push(line);
      }
      continue;
    }

    // Block comments
    if (t.startsWith("/*")) {
      result.push(truncate(line, 100));
      continue;
    }

    // Top-level DDL without a body (CREATE TABLE, ALTER TABLE, CREATE INDEX, DROP)
    if (/^(CREATE|ALTER|DROP)\b/i.test(t)) {
      result.push(truncate(line, 120));
      symbols++;
      continue;
    }

    // Top-level DML (only outside proc bodies)
    if (/^(INSERT|UPDATE|DELETE|MERGE|WITH|SELECT)\b/i.test(t)) {
      result.push(truncate(line, 100));
    }
  }

  return { outline: result, symbols };
}
