/**
 * Parser for `liquibase validate` output.
 *
 * The happy path is a single line — `No validation errors found.` — which
 * collapses to `{ valid: true, errorCount: 0, errors: [] }`. A failure prints a
 * `Validation Failed:` block (or an `Unexpected error running Liquibase:`
 * preamble) listing offending changesets as `<file>::<id>::<author>` references,
 * grouped under category headers like `N changesets had duplicate identifiers`.
 *
 * Like every parser in this group it is pure and never throws — unexpected
 * shapes yield a safe partial rather than an exception.
 */

import { stripBanner } from "./banner.js";
import { splitChangesetRef } from "./changeset-ref.js";

/** A single validation error tied (where possible) to a changeset. */
export interface ValidateError {
  changesetId?: string;
  file?: string;
  message: string;
}

export interface ValidateResult {
  valid: boolean;
  errorCount: number;
  errors: ValidateError[];
}

/** Matches a `N change set(s) <category>` header that groups error refs. */
const CATEGORY_RE = /^\d+\s+change\s?sets?\s+(.+)$/i;

/** Parse `liquibase validate` output into a pass/fail result with errors. */
export function parseValidate(raw: string): ValidateResult {
  const text = stripBanner(raw);

  if (/No validation errors found\./.test(text)) {
    return { valid: true, errorCount: 0, errors: [] };
  }

  const errors: ValidateError[] = [];
  let category = "validation error";

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const cat = trimmed.match(CATEGORY_RE);
    if (cat?.[1]) {
      category = cat[1].trim();
      continue;
    }

    // A changeset reference is the first whitespace-delimited token; any
    // trailing text (e.g. "was: X but is now: Y") is extra detail.
    const space = trimmed.indexOf(" ");
    const head = space === -1 ? trimmed : trimmed.slice(0, space);
    const rest = space === -1 ? "" : trimmed.slice(space + 1).trim();
    const ref = splitChangesetRef(head);
    if (ref) {
      errors.push({
        file: ref.file,
        changesetId: ref.id,
        message: rest ? `${category}: ${rest}` : category,
      });
    }
  }

  const failed =
    errors.length > 0 || /Validation Failed|Unexpected error/i.test(text);
  return { valid: !failed, errorCount: errors.length, errors };
}
