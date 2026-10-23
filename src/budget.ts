/**
 * Central response budget — one cap on how big a tool's payload may be.
 *
 * `defineTool` runs every result through `fitToBudget` before it leaves the
 * server. A payload under the limit passes through untouched. A payload over it
 * has its arrays cut to an order-preserving prefix until it fits, and every cut
 * is reported in `omitted`, so truncation is never silent. Arrays only: a cut
 * array still matches the tool's `outputSchema`, and a cut string would not mean
 * the same thing. Long strings are capped by the tools that make them (`cat`,
 * `kube_logs`).
 *
 * Modes (`BASH_MCP_RESPONSE_MODE`), as limits on serialized JSON characters:
 *
 *   summary  4,000      a few rows of each list
 *   compact  12,000
 *   auto     16,000     doubled to 32,000 for an error or an unhealthy
 *                       diagnosis, where the detail is the point (default)
 *   full     no limit   v4 behaviour
 *
 * Roughly four characters per token, so `auto` stays near 4k tokens and well
 * under Claude Code's 25k-token MCP output limit.
 */

export const RESPONSE_MODES = ["auto", "summary", "compact", "full"] as const;
export type ResponseMode = (typeof RESPONSE_MODES)[number];

const LIMITS: Record<Exclude<ResponseMode, "full">, number> = {
  summary: 4_000,
  compact: 12_000,
  auto: 16_000,
};

/** Triage fields that are short and carry the answer; never cut. */
const PROTECTED = new Set(["likelyCauses", "suggestedNextCommands"]);

/** `BASH_MCP_RESPONSE_MODE`, or `auto`. Throws on an unknown value. */
export function responseModeFromEnv(
  raw = process.env.BASH_MCP_RESPONSE_MODE,
): ResponseMode {
  if (raw === undefined || raw === "") return "auto";
  if ((RESPONSE_MODES as readonly string[]).includes(raw)) {
    return raw as ResponseMode;
  }
  throw new Error(
    `BASH_MCP_RESPONSE_MODE=${raw} is not one of ${RESPONSE_MODES.join(", ")}`,
  );
}

/**
 * Does this payload report a problem? Errors and unhealthy diagnoses get twice
 * the `auto` room. Reads the fields tools already use for a verdict.
 */
export function isUnhealthy(
  payload: Record<string, unknown>,
  isError: boolean,
): boolean {
  if (isError) return true;
  if (
    payload.success === false ||
    payload.valid === false ||
    payload.healthy === false
  ) {
    return true;
  }
  const status = payload.status;
  return (
    typeof status === "string" &&
    Array.isArray(payload.likelyCauses) &&
    status !== "Healthy"
  );
}

/** The character limit for a mode, or `Infinity` for `full`. */
export function limitFor(mode: ResponseMode, unhealthy: boolean): number {
  if (mode === "full") return Number.POSITIVE_INFINITY;
  const base = LIMITS[mode];
  return mode === "auto" && unhealthy ? base * 2 : base;
}

export interface Omission {
  /** Dotted path to the array, indices included: `files.0`. */
  path: string;
  total: number;
  shown: number;
}

interface ArrayRef {
  holder: Record<string, unknown> | unknown[];
  key: string | number;
  path: string;
  size: number;
}

function collectArrays(
  value: unknown,
  path: string,
  out: ArrayRef[],
  top: boolean,
): void {
  if (!value || typeof value !== "object") return;
  const entries: [string | number, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [i, v])
    : Object.entries(value);
  for (const [key, child] of entries) {
    if (top && typeof key === "string" && PROTECTED.has(key)) continue;
    const childPath = path === "" ? String(key) : `${path}.${key}`;
    if (Array.isArray(child) && child.length > 1) {
      out.push({
        holder: value as ArrayRef["holder"],
        key,
        path: childPath,
        size: JSON.stringify(child).length,
      });
    }
    collectArrays(child, childPath, out, false);
  }
}

function resolves(root: unknown, path: string): boolean {
  let node: unknown = root;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return false;
    node = (node as Record<string, unknown>)[part];
  }
  return Array.isArray(node);
}

/**
 * Cut `payload` to `limit` serialized characters.
 *
 * Each pass shrinks the largest remaining array, in proportion to how far over
 * the limit the payload is, keeping at least one element so the shape stays
 * visible. Stops when the payload fits or every array is down to one element.
 * Deterministic: the same payload and limit always give the same cut.
 * `payload` itself is not modified.
 */
export function fitToBudget(
  payload: Record<string, unknown>,
  limit: number,
): {
  payload: Record<string, unknown>;
  omitted: Omission[];
  size: number;
  originalSize: number;
} {
  const originalSize = JSON.stringify(payload).length;
  if (originalSize <= limit) {
    return { payload, omitted: [], size: originalSize, originalSize };
  }
  const clone = structuredClone(payload);
  const totals = new Map<string, number>();
  let size = originalSize;
  while (size > limit) {
    const arrays: ArrayRef[] = [];
    collectArrays(clone, "", arrays, true);
    const biggest = arrays.reduce<ArrayRef | undefined>(
      (best, a) => (!best || a.size > best.size ? a : best),
      undefined,
    );
    if (!biggest) break;
    const arr = (biggest.holder as Record<string | number, unknown[]>)[
      biggest.key
    ] as unknown[];
    const keepRatio = Math.max(0, biggest.size - (size - limit)) / biggest.size;
    const keep = Math.min(
      arr.length - 1,
      Math.max(1, Math.floor(arr.length * keepRatio)),
    );
    if (!totals.has(biggest.path)) totals.set(biggest.path, arr.length);
    (biggest.holder as Record<string | number, unknown>)[biggest.key] =
      arr.slice(0, keep);
    size = JSON.stringify(clone).length;
  }
  const omitted: Omission[] = [];
  for (const [path, total] of totals) {
    if (!resolves(clone, path)) continue;
    const shown = (
      path
        .split(".")
        .reduce<unknown>(
          (n, p) => (n as Record<string, unknown>)[p],
          clone,
        ) as unknown[]
    ).length;
    omitted.push({ path, total, shown });
  }
  omitted.sort((a, b) => a.path.localeCompare(b.path));
  return { payload: clone, omitted, size, originalSize };
}

/**
 * Cut a text block to `limit` characters at a line boundary, saying how many
 * lines it kept. Text under the limit is returned as is.
 */
export function capText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let cut = text.lastIndexOf("\n", limit);
  if (cut < limit / 2) cut = limit;
  const kept = text.slice(0, cut);
  const total = text.split("\n").length;
  const shown = kept.split("\n").length;
  return `${kept}\n[text cut at ${shown} of ${total} lines]`;
}
