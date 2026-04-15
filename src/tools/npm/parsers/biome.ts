import type { Diagnostic } from "./types.js";

/**
 * Parse biome's JSON reporter output into structured diagnostics.
 *
 * Biome's --reporter=json outputs a JSON object with a `diagnostics` array.
 * Each diagnostic has category, severity, description, and location info.
 */
export function parseBiomeDiagnostics(raw: string): Diagnostic[] {
  const json = JSON.parse(raw);

  // Biome JSON reporter wraps everything in a top-level object
  const diagnostics: unknown[] = json.diagnostics ?? json ?? [];
  if (!Array.isArray(diagnostics)) return [];

  return diagnostics
    .filter(
      (d): d is Record<string, unknown> => d != null && typeof d === "object",
    )
    .map((d) => {
      const location = d.location as Record<string, unknown> | undefined;
      const path = location?.path as Record<string, unknown> | undefined;
      const span = location?.span as Record<string, number> | undefined;
      const sourceCode = (location?.sourceCode as string) ?? "";

      // Convert byte offset to line/column
      const { line, column } = offsetToLineCol(sourceCode, span?.start ?? 0);

      const severity = mapSeverity(d.severity as string);
      const category = (d.category as string) ?? "";
      // Biome message can be a string or structured array
      const message = extractMessage(d);

      return {
        file: (path?.file as string) ?? "",
        line,
        column,
        message,
        severity,
        rule: category || undefined,
      };
    });
}

/** Map biome severity strings (including "fatal") to our three-level enum. */
function mapSeverity(s: string): "error" | "warning" | "info" {
  if (s === "error" || s === "fatal") return "error";
  if (s === "warning") return "warning";
  return "info";
}

/** Extract a human-readable message from a biome diagnostic (string or structured array). */
function extractMessage(d: Record<string, unknown>): string {
  // Try description first (simple string)
  if (typeof d.description === "string") return d.description;
  // Try message array
  const msg = d.message;
  if (Array.isArray(msg)) {
    return msg
      .map((m) =>
        typeof m === "string"
          ? m
          : ((m as Record<string, unknown>)?.content ?? ""),
      )
      .join("");
  }
  if (typeof msg === "string") return msg;
  return String(d.category ?? "unknown diagnostic");
}

/** Convert a byte offset in source code to a 1-based line and column number. */
function offsetToLineCol(
  source: string,
  offset: number,
): { line: number; column: number } {
  if (!source || offset <= 0) return { line: 1, column: 1 };
  let line = 1;
  let col = 1;
  for (let i = 0; i < Math.min(offset, source.length); i++) {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, column: col };
}
