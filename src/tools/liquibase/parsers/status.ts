/**
 * Parser for `liquibase status --verbose` output.
 *
 * When changesets are pending Liquibase prints
 * `N changesets have not been applied to <conn>` followed by 5-space-indented
 * `<file>::<id>::<author>` references. When the database is current it instead
 * prints a `<conn> is up to date` line. Pure and total — never throws.
 */

import { stripBanner } from "./banner.js";
import { splitChangesetRef } from "./changeset-ref.js";

export interface PendingChangeset {
  id: string;
  author: string;
  file: string;
}

export interface StatusResult {
  upToDate: boolean;
  pendingCount: number;
  pending: PendingChangeset[];
}

/** Matches the `N changesets have not been applied …` summary line. */
const PENDING_RE = /(\d+)\s+changesets?\s+have not been applied/i;

/** Parse `liquibase status --verbose` output into pending changesets. */
export function parseStatus(raw: string): StatusResult {
  const text = stripBanner(raw);

  if (/\bis up to date\b/i.test(text)) {
    return { upToDate: true, pendingCount: 0, pending: [] };
  }

  const pending: PendingChangeset[] = [];
  for (const line of text.split("\n")) {
    const ref = splitChangesetRef(line.trim());
    if (ref) {
      pending.push({ file: ref.file, id: ref.id, author: ref.author });
    }
  }

  const summary = text.match(PENDING_RE);
  const pendingCount = summary?.[1]
    ? Number.parseInt(summary[1], 10)
    : pending.length;

  return { upToDate: pendingCount === 0, pendingCount, pending };
}
