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

/** Parse `.terraform/modules/modules.json` into a module list (root excluded). */
export function parseModules(raw: {
  Modules?: Array<{ Key?: string; Source?: string; Version?: string }>;
}): Array<{ key: string; source: string; version: string }> {
  return (raw?.Modules ?? [])
    .filter((m) => m.Key) // root module has an empty Key
    .map((m) => ({
      key: m.Key ?? "",
      source: m.Source ?? "",
      version: m.Version ?? "",
    }));
}

/** Parse `.terraform/terraform.tfstate` backend pointer into type + config. */
export function parseBackend(raw: {
  backend?: { type?: string; config?: Record<string, unknown> };
}): { type: string; config: Record<string, string> } {
  const config: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw?.backend?.config ?? {})) {
    if (v === null || v === undefined) continue;
    config[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return { type: raw?.backend?.type ?? "", config };
}

/**
 * Count one resource change's actions. A replace is `["delete","create"]` (or
 * the reverse), so it counts as both an add and a destroy — the tallies are
 * independent, not a first-match dispatch.
 *
 * Shared by both plan paths: `parsePlanJson` (from `terraform show -json`) and
 * the `-json` stream loop in `tf_plan_summary`. They previously counted
 * replaces differently, so one tool reported two different numbers depending
 * on whether `planFile` was passed.
 */
export function tallyActions(actions: string[]): {
  add: number;
  change: number;
  destroy: number;
} {
  return {
    add: actions.includes("create") ? 1 : 0,
    change: actions.includes("update") ? 1 : 0,
    destroy: actions.includes("delete") ? 1 : 0,
  };
}

/** Parse `terraform show -json <plan>` resource_changes into a change summary. */
export function parsePlanJson(raw: {
  resource_changes?: Array<{
    address?: string;
    type?: string;
    change?: { actions?: string[] };
  }>;
}): {
  add: number;
  change: number;
  destroy: number;
  changes: Array<{ action: string; address: string; type: string }>;
  noChanges: boolean;
} {
  const changes: Array<{ action: string; address: string; type: string }> = [];
  let add = 0;
  let change = 0;
  let destroy = 0;

  for (const rc of raw?.resource_changes ?? []) {
    const actions = rc.change?.actions ?? [];
    if (actions.length === 0 || actions.includes("no-op")) continue;
    changes.push({
      action: actions.join(","),
      address: rc.address ?? "",
      type: rc.type ?? "",
    });
    const t = tallyActions(actions);
    add += t.add;
    change += t.change;
    destroy += t.destroy;
  }

  return {
    add,
    change,
    destroy,
    changes,
    noChanges: add === 0 && change === 0 && destroy === 0,
  };
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
