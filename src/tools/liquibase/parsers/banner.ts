/**
 * Liquibase banner / noise stripper.
 *
 * Every Liquibase invocation prints a ~14-line `####`-bordered ASCII-art
 * banner, a `Starting Liquibase at … using Java …` line, and a
 * `Liquibase Version: …` line. `updateSQL` additionally frames its output with
 * lock/unlock statements (`-- Lock Database` / `-- Release Database Lock` and
 * the `UPDATE DATABASECHANGELOGLOCK …` rows). None of that is meaningful to a
 * caller, so the three liquibase tools run `stripBanner()` over the raw output
 * before parsing.
 *
 * Pure and total: it never throws and only filters whole lines, so a changed
 * banner shape at worst leaves a few stray lines for the downstream parser
 * (which is itself tolerant) rather than dropping real content.
 */

/** Line predicates identifying banner / framing noise to drop. */
const NOISE = [
  /^\s*#{2,}/, // ASCII-art banner border + body (`####…` and `##  …  ##`)
  /^Starting Liquibase\b/,
  /^Liquibase Version:/,
  /^-- Lock Database\s*$/,
  /^-- Release Database Lock\s*$/,
  /^UPDATE DATABASECHANGELOGLOCK\b/i,
];

/**
 * Remove Liquibase banner, startup, and lock-framing lines from raw CLI output.
 *
 * Carriage returns are stripped first so callers can match against `\n`-only
 * text — Liquibase emits CRLF inside rendered SQL bodies but LF for its own
 * framing lines. The result is trimmed of leading/trailing blank lines.
 */
export function stripBanner(raw: string): string {
  const lines = raw.replace(/\r/g, "").split("\n");
  const kept = lines.filter((line) => !NOISE.some((re) => re.test(line)));
  return kept.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
}
