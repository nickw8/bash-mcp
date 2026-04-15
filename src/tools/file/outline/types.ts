/**
 * Shared types and helpers for outline extractors.
 */

export type Language =
  | "bash"
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

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.substring(0, max - 3)}...` : s;
}
