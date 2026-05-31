/**
 * Pure parsers for Terraform/OpenTofu JSON output.
 *
 * Extracted so they can be fixture-tested without running terraform
 * (`/arch:node`: pure functions + co-located tests). String/JSON in,
 * structured out; never throw on missing fields.
 */

/** A single terraform output value (value omitted when sensitive). */
export interface TfOutput {
  name: string;
  type: string;
  sensitive: boolean;
  value?: string;
}

/** Parse `terraform output -json` into a compact list (redacts sensitive values). */
export function parseOutputs(
  raw: Record<string, { value?: unknown; type?: unknown; sensitive?: boolean }>,
): TfOutput[] {
  return Object.entries(raw ?? {}).map(([name, o]) => {
    const sensitive = o?.sensitive === true;
    const type =
      typeof o?.type === "string" ? o.type : JSON.stringify(o?.type ?? null);
    let value: string | undefined;
    if (!sensitive && o?.value !== undefined) {
      value =
        typeof o.value === "object" ? JSON.stringify(o.value) : String(o.value);
    }
    return { name, type, sensitive, value };
  });
}

/** Parse `terraform version -json` provider selections into a list. */
export function parseProviders(data: {
  terraform_version?: string;
  provider_selections?: Record<string, string>;
}): {
  version: string;
  providers: Array<{ name: string; source: string; version: string }>;
} {
  const providers = Object.entries(data?.provider_selections ?? {}).map(
    ([source, version]) => ({
      name: source.split("/").pop() ?? source,
      source,
      version,
    }),
  );
  return { version: data?.terraform_version ?? "", providers };
}

/** Parse `terraform validate -json` into a compact summary. */
export function parseValidate(data: {
  valid?: boolean;
  error_count?: number;
  warning_count?: number;
  diagnostics?: Array<{
    severity?: string;
    summary?: string;
    detail?: string;
    range?: { filename?: string; start?: { line?: number } };
  }>;
}): {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  diagnostics: Array<{
    severity: string;
    summary: string;
    file?: string;
    line?: number;
  }>;
} {
  const diagnostics = (data?.diagnostics ?? []).map((d) => ({
    severity: d.severity ?? "error",
    summary: d.summary ?? "",
    file: d.range?.filename,
    line: d.range?.start?.line,
  }));
  return {
    valid: data?.valid ?? diagnostics.every((d) => d.severity !== "error"),
    errorCount: data?.error_count ?? 0,
    warningCount: data?.warning_count ?? 0,
    diagnostics,
  };
}
