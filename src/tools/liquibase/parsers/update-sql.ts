/**
 * Parser for `liquibase updateSQL` output.
 *
 * `updateSQL` renders the full migration script: a `-- Update Database Script`
 * preamble, then one block per pending changeset, each introduced by a
 * `-- Changeset <file>::<id>::<author>` marker, an optional `-- /* comment *​/`
 * line, the rendered SQL (CRLF line endings, `GO`-separated batches), and a
 * trailing `INSERT INTO DATABASECHANGELOG …` (first run) or
 * `UPDATE DATABASECHANGELOG …` (re-run) tracking statement.
 *
 * The parser splits on the changeset markers, strips the tracking statement
 * from each block's SQL, and derives a compact summary per changeset. It also
 * runs the SQL-Server "DDL must be first in its batch" lint (`batchLint`) over
 * the rendered batches. Pure and total — never throws; unexpected shapes yield a
 * safe partial.
 */

import { stripBanner } from "./banner.js";
import { splitChangesetRef } from "./changeset-ref.js";

/** Result of the SQL-Server batch lint for a routine-creating changeset. */
export interface BatchLint {
  ok: boolean;
  reason?: string;
}

export interface Changeset {
  id: string;
  author: string;
  file: string;
  contexts?: string;
  labels?: string;
  /** Count of meaningful SQL lines (excludes comments, blanks, and `GO`). */
  sqlLineCount: number;
  /** First executable statement in the block (truncated). */
  firstStatement?: string;
  /** Present only when the changeset creates a routine (proc/func/view/trigger). */
  batchLint?: BatchLint;
  /** Full rendered SQL for the changeset (tracking statement removed). */
  sql: string;
}

export interface UpdateSqlResult {
  changesetCount: number;
  changesets: Changeset[];
}

const MARKER_RE = /^-- Changeset (.+)$/;
/** A DATABASECHANGELOG tracking statement (not the LOCK table). */
const TRACKING_RE = /^(INSERT INTO|UPDATE)\s+DATABASECHANGELOG\b/i;
/** `CREATE [OR ALTER] PROCEDURE|FUNCTION|VIEW|TRIGGER` (the batch-rule subjects). */
const CREATE_ROUTINE_RE =
  /^(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?(PROCEDURE|PROC|FUNCTION|VIEW|TRIGGER)\b/i;

/** Parse `liquibase updateSQL` output into per-changeset summaries. */
export function parseUpdateSql(
  raw: string,
  opts: { batchLint?: boolean } = {},
): UpdateSqlResult {
  const runLint = opts.batchLint !== false;
  const lines = stripBanner(raw).split("\n");

  // Index every changeset marker, then carve the body between consecutive ones.
  const markerIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (MARKER_RE.test(lines[i] ?? "")) markerIdx.push(i);
  }

  const changesets: Changeset[] = [];
  for (let m = 0; m < markerIdx.length; m++) {
    const start = markerIdx[m] as number;
    const end =
      m + 1 < markerIdx.length ? (markerIdx[m + 1] as number) : lines.length;
    const ref = splitChangesetRef(
      (lines[start] as string).replace(MARKER_RE, "$1"),
    );
    if (!ref) continue;

    const body = lines.slice(start + 1, end);
    const trackingIdx = body.findIndex((l) => TRACKING_RE.test(l.trim()));
    const tracking = trackingIdx === -1 ? "" : (body[trackingIdx] as string);
    const sqlLines = trackingIdx === -1 ? body : body.slice(0, trackingIdx);

    const sql = sqlLines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
    const meaningful = sqlLines.filter((l) => isStatement(l));
    const { contexts, labels } = extractContextsLabels(tracking);

    const changeset: Changeset = {
      id: ref.id,
      author: ref.author,
      file: ref.file,
      contexts,
      labels,
      sqlLineCount: meaningful.length,
      firstStatement: meaningful[0]
        ? truncate(meaningful[0].trim(), 120)
        : undefined,
      sql,
    };

    if (runLint) {
      const lint = lintBatches(sqlLines);
      if (lint) changeset.batchLint = lint;
    }

    changesets.push(changeset);
  }

  return { changesetCount: changesets.length, changesets };
}

/** A line that counts as a SQL statement (not a comment, blank, or `GO`). */
function isStatement(line: string): boolean {
  const t = line.trim();
  return t !== "" && !t.startsWith("--") && !/^GO\s*$/i.test(t);
}

/**
 * Lint a changeset's rendered SQL for the SQL-Server batch rule: a
 * `CREATE PROCEDURE|FUNCTION|VIEW|TRIGGER` must be the first statement in its
 * batch (batches are delimited by `GO`). Returns null when the changeset
 * contains no routine DDL (the rule does not apply).
 */
function lintBatches(sqlLines: string[]): BatchLint | null {
  let batch: string[] = [];
  const batches: string[][] = [];
  for (const line of sqlLines) {
    if (/^GO\s*$/i.test(line.trim())) {
      batches.push(batch);
      batch = [];
    } else {
      batch.push(line);
    }
  }
  batches.push(batch);

  for (const b of batches) {
    const statements = b.filter(isStatement);
    const createIdx = statements.findIndex((s) =>
      CREATE_ROUTINE_RE.test(s.trim()),
    );
    if (createIdx === -1) continue; // no routine in this batch
    if (createIdx === 0) return { ok: true };

    const preceding = firstKeyword(statements[0] as string);
    const create = createKeyword(statements[createIdx] as string);
    return {
      ok: false,
      reason: `${preceding} precedes ${create} — DDL not first in batch`,
    };
  }

  return null; // no routine DDL anywhere → rule does not apply
}

/** Extract contexts/labels from a tracking statement (both INSERT and UPDATE shapes). */
function extractContextsLabels(tracking: string): {
  contexts?: string;
  labels?: string;
} {
  if (!tracking) return {};

  // Named UPDATE form: `… CONTEXTS = NULL, … LABELS = 'security' …`
  if (/^UPDATE\s+DATABASECHANGELOG\b/i.test(tracking.trim())) {
    return {
      contexts: namedValue(tracking, "CONTEXTS"),
      labels: namedValue(tracking, "LABELS"),
    };
  }

  // Positional INSERT form: the tuple ends with a known, comma-free tail:
  //   …, '<EXECTYPE>', <CONTEXTS>, <LABELS>, '<LIQUIBASE>', '<DEPLOYMENT_ID>')
  const tail = tracking.match(
    /,\s*'[^']*'\s*,\s*(NULL|'[^']*')\s*,\s*(NULL|'[^']*')\s*,\s*'[\d.]+'\s*,\s*'[^']*'\s*\)\s*$/i,
  );
  if (tail) {
    return { contexts: unquote(tail[1]), labels: unquote(tail[2]) };
  }
  return {};
}

/** Read a `NAME = NULL | 'value'` assignment from a named UPDATE statement. */
function namedValue(text: string, name: string): string | undefined {
  const m = text.match(new RegExp(`\\b${name}\\s*=\\s*(NULL|'[^']*')`, "i"));
  return m ? unquote(m[1]) : undefined;
}

/** Turn a SQL literal token into a value: NULL → undefined, 'x' → x. */
function unquote(token: string | undefined): string | undefined {
  if (!token || /^NULL$/i.test(token)) return undefined;
  return token.replace(/^'/, "").replace(/'$/, "");
}

/** Leading keyword of a statement, for lint messages (e.g. "USE", "SET"). */
function firstKeyword(line: string): string {
  return (line.trim().split(/\s+/)[0] ?? "statement").toUpperCase();
}

/** The routine kind a CREATE/ALTER targets, e.g. `CREATE PROCEDURE`, for lint messages. */
function createKeyword(line: string): string {
  const obj = (
    line.trim().match(CREATE_ROUTINE_RE)?.[1] ?? "PROCEDURE"
  ).toUpperCase();
  return `CREATE ${obj === "PROC" ? "PROCEDURE" : obj}`;
}

/** Truncate a string to a max length with an ellipsis. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
