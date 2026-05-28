/**
 * Shared Zod schemas matching the interfaces in types.ts.
 *
 * Tool output schemas import these instead of redefining inline Zod objects,
 * ensuring consistency across npm, dotnet, and future tool groups.
 */

import { z } from "zod";
import type { Diagnostic } from "./types.js";

export const diagnosticSchema = z.object({
  file: z.string(),
  line: z.number(),
  column: z.number(),
  message: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string().optional(),
});

export const testResultSchema = z.object({
  name: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
  duration: z.number(),
  failureMessage: z.string().optional(),
});

export function countBySeverity(diagnostics: Diagnostic[]) {
  let errorCount = 0;
  let warningCount = 0;
  for (const d of diagnostics) {
    if (d.severity === "error") errorCount++;
    else if (d.severity === "warning") warningCount++;
  }
  return { errorCount, warningCount };
}
