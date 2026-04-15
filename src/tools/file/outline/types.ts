/**
 * Shared types and helpers for outline extractors.
 */

export type Language =
  | "bash"
  | "csharp"
  | "python"
  | "typescript"
  | "javascript"
  | "sql"
  | "yaml"
  | "markdown"
  | "unknown";

export interface ExtractResult {
  outline: string[];
  symbols: number;
}

/** Truncate a string to max length, appending "..." if truncated. */
export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.substring(0, max - 3)}...` : s;
}
