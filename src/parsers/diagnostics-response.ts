/**
 * Shared response builder for diagnostic-emitting tools (typecheck, lint, build).
 *
 * These tools (npm_typecheck, python_typecheck, python_lint, dotnet_build) all
 * parse a Diagnostic[] and previously returned ok() — full JSON in the text
 * block, repeating file/line/column/severity/rule/message on every row. This
 * routes the text block through okList with a compact, grouped-by-file default
 * (file header once, then `line:col [severity] rule message`) while keeping
 * structuredContent as the complete typed payload. An optional output budget
 * caps large error cascades so a broken build can't blow the token budget.
 */
import { z } from "zod";
import type { ListFormat } from "#format";
import { okList } from "#response";
import { applyBudget, budgetSchema } from "./schemas.js";
import type { BudgetParams, Diagnostic } from "./types.js";

// Reuse the shared budget controls (detailLevel/maxItems) but not includeRaw —
// diagnostics have no verbose form to opt into.
const budgetControls = {
  detailLevel: budgetSchema.detailLevel,
  maxItems: budgetSchema.maxItems,
};

/**
 * Input-schema fragment shared by every diagnostic tool. Spread into a tool's
 * `inputSchema` to add the text-format selector, column projection, and output
 * budget without redefining them each time.
 */
export const diagnosticInputSchema = {
  format: z
    .enum(["grouped", "tsv", "json"])
    .optional()
    .describe(
      "Text format: grouped (default, file header once then line:col rule message), tsv, or json",
    ),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Limit the text view to these columns (e.g. ['file','loc','message']); structuredContent keeps all",
    ),
  ...budgetControls,
};

/**
 * Curate diagnostics into compact text rows: `file` (the grouping column),
 * `loc` (`line:col`), `rule` (when present), and `message`. `severity` is
 * included only when the set is mixed — a uniform all-error list drops it as
 * noise (the row is an error unless told otherwise).
 */
export function diagnosticRows(diags: Diagnostic[]): Record<string, unknown>[] {
  const first = diags[0]?.severity;
  const mixed = diags.some((d) => d.severity !== first);
  return diags.map((d) => {
    const row: Record<string, unknown> = {
      file: d.file,
      loc: `${d.line}:${d.column}`,
    };
    if (mixed) row.severity = d.severity;
    if (d.rule) row.rule = d.rule;
    row.message = d.message;
    return row;
  });
}

export interface DiagnosticsResponseOpts {
  format?: ListFormat;
  budget?: BudgetParams;
  fields?: string[];
  /** Extra meta lines (errorCount, warningCount, …) shown above the rows. */
  meta?: Record<string, unknown>;
}

/**
 * Build a structured diagnostic response: `structuredContent` stays the full
 * typed payload; the text block is the compact grouped/tsv view of `diagnostics`
 * (capped by `budget`, with a `shown`/`total` note when truncated).
 */
export function diagnosticsResponse<T extends Record<string, unknown>>(
  structuredContent: T,
  diagnostics: Diagnostic[],
  opts: DiagnosticsResponseOpts = {},
) {
  const { items, truncated, total } = applyBudget(
    diagnostics,
    opts.budget ?? {},
  );
  const rows = diagnosticRows(items);
  const meta: Record<string, unknown> = { ...opts.meta };
  if (truncated) {
    meta.shown = items.length;
    meta.total = total;
  }
  return okList(structuredContent, rows, meta, opts.format ?? "grouped", {
    fields: opts.fields,
  });
}
