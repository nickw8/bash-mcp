/**
 * Shell Utilities
 *
 * Shared helpers for safely constructing shell commands.
 */

/** Escape a string for safe inclusion in a shell command (single-quote wrapping). */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
