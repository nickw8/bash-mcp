/**
 * Shared Zod schemas matching the interfaces in types.ts.
 *
 * Tool output schemas import these instead of redefining inline Zod objects,
 * ensuring consistency across npm, dotnet, and future tool groups.
 */

import { z } from "zod";
import type { BudgetParams, Diagnostic } from "./types.js";

/**
 * Zod fragment for a param that accepts either a single string or an array of
 * strings, normalized with {@link toArray} in the handler. Mirrors rg's `glob`
 * multi-value pattern so callers can pass one value or many.
 */
export function stringOrArray(description: string) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(description);
}

/** Normalize an optional string|string[] param into an array (empty if unset). */
export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

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

/**
 * Shared output-budget Zod fragment. Spread into a tool's `inputSchema` to add
 * caller-controlled size limits without redefining the params each time:
 *   inputSchema: { resource: z.string(), ...budgetSchema }
 */
export const budgetSchema = {
  detailLevel: z
    .enum(["summary", "normal", "full"])
    .optional()
    .describe(
      "Output size preset: summary (~20 items), normal (~100), full (uncapped, default).",
    ),
  maxItems: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Explicit cap on returned items; overrides detailLevel."),
  includeRaw: z
    .boolean()
    .optional()
    .describe("Include raw/verbose fields where supported."),
};

/**
 * Shared output-schema fragment for diagnostic/triage tools. Spread into a
 * tool's `outputSchema` so the { status, likelyCauses, suggestedNextCommands,
 * evidence } envelope stays identical across kube/helm/argo; add tool-specific
 * fields (healthy, name, revision, pods, …) alongside the spread:
 *   outputSchema: { healthy: z.boolean(), ...triageSchema }
 * Matches the {@link Triage} interface in types.ts.
 */
export const triageSchema = {
  status: z.string(),
  likelyCauses: z.array(z.string()),
  suggestedNextCommands: z.array(z.string()),
  evidence: z.array(z.string()),
};

/** Default item caps per detailLevel; full (and unset) means no cap. */
const DETAIL_CAPS = { summary: 20, normal: 100, full: Infinity } as const;

/**
 * Apply an output budget to a list of rows.
 *
 * The effective cap is `maxItems` if given, else the detailLevel default
 * (full/unset → no cap). Returns the (possibly) truncated rows plus the
 * original total and a `truncated` flag. Omitting all params returns the list
 * unchanged.
 */
export function applyBudget<T>(
  rows: T[],
  budget: BudgetParams,
): { items: T[]; truncated: boolean; total: number } {
  const total = rows.length;
  const cap = budget.maxItems ?? DETAIL_CAPS[budget.detailLevel ?? "full"];
  if (total > cap) {
    return { items: rows.slice(0, cap), truncated: true, total };
  }
  return { items: rows, truncated: false, total };
}

export function countBySeverity(diagnostics: Diagnostic[]) {
  let errorCount = 0;
  let warningCount = 0;
  for (const d of diagnostics) {
    if (d.severity === "error") errorCount++;
    else if (d.severity === "warning") warningCount++;
  }
  return { errorCount, warningCount };
}
