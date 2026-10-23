/**
 * Shared response builder for diagnostic-emitting tools (typecheck, lint, build).
 *
 * These tools (npm_typecheck, python_typecheck, python_lint, bash_lint,
 * bash_syntax_check, npm_lint, dotnet_build) all parse a Diagnostic[] and hand
 * it here; all but the dotnet and npm lint tools go through `diagnosticRun`,
 * which owns stream choice, merging, counting, severity filtering and the empty
 * answer around it. The payload — the artifact the agent is
 * billed for (ADR-0009) — is grouped by file so a path is paid once, with each
 * diagnostic encoded as one `line:col [severity] [rule] message` string instead
 * of a six-key object. The text block is the same data rendered by okList for
 * clients that read it. The output budget caps large error cascades in both.
 */
import { z } from "zod";
import { classifyError } from "#error";
import type { ExecResult } from "#exec";
import type { ListFormat } from "#format";
import { err, ok, okList } from "#response";
import { applyBudget, budgetSchema, countBySeverity } from "./schemas.js";
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
      "Limit the text view to these columns (e.g. ['file','loc','message']) — affects the text block only, not the returned payload",
    ),
  ...budgetControls,
};

/** One file's diagnostics: the path once, then `line:col [severity] [rule] message` per finding. */
export const fileDiagnosticsSchema = z.object({
  file: z.string(),
  items: z.array(z.string()),
});

/**
 * Output-schema fragment shared by diagnostic tools that name their list
 * `errors`. Spread into `outputSchema` alongside the tool's own counts.
 */
export const diagnosticOutputSchema = {
  errors: z.array(fileDiagnosticsSchema),
  total: z.number().optional(),
  truncated: z.boolean().optional(),
};

/**
 * Group diagnostics by file for the payload: the path is paid once and each
 * finding becomes `line:col [severity] [rule] message`. Severity is emitted
 * only when the set is mixed — a uniform list is described by the counts that
 * travel alongside it.
 */
export function compactDiagnostics(
  diags: Diagnostic[],
): { file: string; items: string[] }[] {
  const first = diags[0]?.severity;
  const mixed = diags.some((d) => d.severity !== first);
  const byFile = new Map<string, string[]>();
  for (const d of diags) {
    const parts = [`${d.line}:${d.column}`];
    if (mixed) parts.push(d.severity);
    if (d.rule) parts.push(d.rule);
    parts.push(d.message);
    const items = byFile.get(d.file);
    if (items) items.push(parts.join(" "));
    else byFile.set(d.file, [parts.join(" ")]);
  }
  return [...byFile].map(([file, items]) => ({ file, items }));
}

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
  /** Payload key holding the grouped diagnostics (default `errors`). */
  key?: string;
}

/**
 * Build a diagnostic response. The grouped, budget-capped diagnostics are
 * written into the payload under `opts.key` (overriding whatever the caller
 * put there), with `total`/`truncated` added when the budget bit; the text
 * block is the same list rendered grouped/tsv/json.
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
  const payload = {
    ...structuredContent,
    [opts.key ?? "errors"]: compactDiagnostics(items),
    ...(truncated ? { total, truncated } : {}),
  };
  return okList(payload, rows, meta, opts.format ?? "grouped", {
    fields: opts.fields,
  });
}

const SEVERITY_RANK = { error: 3, warning: 2, info: 1 } as const;

type Counts = { errorCount: number; warningCount?: number };

export interface DiagnosticRunOpts<F extends Record<string, unknown>> {
  /** The CLI's name, for the error answered when it never ran, timed out, or failed unreadably. */
  command: string;
  /** The CLI's result — one invocation, or several to merge (`bash -n` per file). */
  results: ExecResult | ExecResult[];
  /** Read text into Diagnostics. May throw; see `onParseError`. */
  parse: (text: string) => Diagnostic[];
  /** Which stream each result is read from (default `stdout || stderr`). */
  stream?: "stderr";
  /** `severity` (default) counts errors and warnings; `total` counts every finding as `errorCount`. */
  count?: "severity" | "total";
  /** Drop findings below this severity — after counting. */
  minSeverity?: keyof typeof SEVERITY_RANK;
  /** Tool-specific output fields, merged after the counts. */
  fields?: (counts: Counts, results: ExecResult[]) => F;
  /** Keys of the output fields echoed in the text meta (default: all of them). */
  metaKeys?: string[];
  /**
   * Answer a bare `ok({errors: [], ...fields})` instead of the list response:
   * `blank-output` when every stream is blank (the parser is not called);
   * `no-findings` when no finding is left after parsing and filtering.
   */
  bareWhen?: "blank-output" | "no-findings";
  /** Answer for a parser that throws; receives the text it choked on. Without it the throw propagates. */
  onParseError?: (text: string) => ReturnType<typeof err>;
  format?: ListFormat;
  detailLevel?: BudgetParams["detailLevel"];
  maxItems?: BudgetParams["maxItems"];
  textFields?: string[];
}

/**
 * Diagnostic run: read one or more CLI results as Diagnostics and answer with
 * counts plus findings. Pure — the caller owns the exec call and the schemas.
 */
export function diagnosticRun<F extends Record<string, unknown>>(
  o: DiagnosticRunOpts<F>,
) {
  const results = Array.isArray(o.results) ? o.results : [o.results];
  const texts = results.map((r) =>
    o.stream === "stderr" ? r.stderr : r.stdout || r.stderr,
  );

  // A run that never started or was killed has no findings to trust.
  const broken = results.find((r) => r.errorCode || r.timedOut);
  if (broken) {
    const error = classifyError(broken, o.command);
    return err(error.message, undefined, error);
  }

  const blank = texts.every((t) => !t.trim());
  let diagnostics: Diagnostic[];
  try {
    diagnostics =
      blank && o.bareWhen === "blank-output"
        ? []
        : texts.flatMap((t) => o.parse(t));
  } catch {
    if (!o.onParseError) throw new Error("diagnostic parse failed");
    return o.onParseError(texts[0] ?? "");
  }

  // Linters exit non-zero WITH findings (a normal result, ADR-0005); non-zero
  // and nothing parsed means the CLI failed in a way we could not read.
  const failed = results.find((r) => r.exitCode !== 0);
  if (failed && diagnostics.length === 0) {
    const error = classifyError(failed, o.command);
    const tail = (texts.join("\n").trim() || error.message).slice(-500);
    return err(tail, undefined, { ...error, message: tail });
  }

  const counts: Counts =
    o.count === "total"
      ? { errorCount: diagnostics.length }
      : countBySeverity(diagnostics);

  if (o.minSeverity) {
    const minRank = SEVERITY_RANK[o.minSeverity];
    diagnostics = diagnostics.filter(
      (d) => SEVERITY_RANK[d.severity] >= minRank,
    );
  }

  const extra = o.fields?.(counts, results);
  const fields = { ...counts, ...extra };

  const bare =
    o.bareWhen === "no-findings"
      ? diagnostics.length === 0
      : o.bareWhen === "blank-output" && blank;
  if (bare) {
    return ok({ errors: [], ...fields });
  }

  const meta = o.metaKeys
    ? Object.fromEntries(
        o.metaKeys.map((k) => [k, (fields as Record<string, unknown>)[k]]),
      )
    : fields;
  return diagnosticsResponse(fields, diagnostics, {
    format: o.format,
    fields: o.textFields,
    budget: { detailLevel: o.detailLevel, maxItems: o.maxItems },
    meta,
  });
}
