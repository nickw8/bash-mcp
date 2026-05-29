import type { Diagnostic } from "#parsers";

function mapSeverity(s: string): Diagnostic["severity"] {
  if (s === "warning" || s === "W") return "warning";
  if (s === "info" || s === "I") return "info";
  return "error";
}

export function parseRuffDiagnostics(raw: string): Diagnostic[] {
  const jsonStart = raw.indexOf("[");
  if (jsonStart < 0) return [];

  const items: unknown[] = JSON.parse(raw.slice(jsonStart));
  if (!Array.isArray(items)) return [];

  return items
    .filter(
      (d): d is Record<string, unknown> => d != null && typeof d === "object",
    )
    .map((d) => {
      const location = d.location as Record<string, number> | undefined;

      return {
        file: (d.filename as string) ?? "",
        line: location?.row ?? 0,
        column: location?.column ?? 0,
        message: (d.message as string) ?? "",
        severity: mapSeverity((d.severity as string) ?? "error"),
        rule: (d.code as string) || undefined,
      };
    });
}
