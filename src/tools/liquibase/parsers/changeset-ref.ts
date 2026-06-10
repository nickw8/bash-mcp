/**
 * Shared parser for Liquibase changeset references.
 *
 * Liquibase identifies a changeset as `<file>::<id>::<author>` across `validate`
 * errors, `updateSQL` markers, and `status` pending lists. The path and author
 * never contain `::`, so a plain split on the double-colon is exact.
 */

export interface ChangesetRef {
  file: string;
  id: string;
  author: string;
}

/** Split a `file::id::author` token, or return null if it isn't one. */
export function splitChangesetRef(token: string): ChangesetRef | null {
  const parts = token.split("::");
  if (parts.length !== 3) return null;
  const [file, id, author] = parts;
  if (!file || !id || !author) return null;
  return { file, id, author };
}
