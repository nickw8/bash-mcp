/**
 * Pure GitHub CLI parsers: `gh pr checks --json` into counted checks, and
 * `gh run view --json` + `--log-failed` into a CI-failure Triage. Pure and
 * fixture-tested; never throws on missing fields.
 */

import type { Triage } from "#parsers";
import { collapseRepeats, markRepeat } from "#shape";

/** One row of `gh pr checks --json name,workflow,bucket,link`. */
export interface GhCheck {
  name?: string;
  workflow?: string;
  /** gh's normalized state: pass, fail, pending, skipping, cancel. */
  bucket?: string;
  link?: string;
}

const BUCKETS = ["pass", "fail", "pending", "skipping", "cancel"] as const;

/**
 * Count checks per bucket and keep the rows worth reading: everything not
 * passed or skipped, unless `all` — a green check is a count, not a row.
 */
export function summarizeChecks(checks: GhCheck[], all = false) {
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<
    (typeof BUCKETS)[number],
    number
  >;
  for (const c of checks) {
    const bucket = c.bucket as keyof typeof counts;
    if (bucket in counts) counts[bucket]++;
  }
  const rows = checks
    .filter((c) => all || (c.bucket !== "pass" && c.bucket !== "skipping"))
    .map((c) => ({
      name: c.name ?? "",
      workflow: c.workflow ?? "",
      bucket: c.bucket ?? "",
      link: c.link ?? "",
    }));
  return { checks: rows, counts };
}

/** The subset of `gh run view --json …` the triage reads. */
export interface GhRun {
  databaseId?: number;
  name?: string;
  displayTitle?: string;
  headBranch?: string;
  status?: string;
  conclusion?: string;
  url?: string;
  jobs?: {
    name?: string;
    conclusion?: string;
    url?: string;
    steps?: { name?: string; conclusion?: string }[];
  }[];
}

/** Job conclusions that mean the job broke rather than passed or was skipped. */
const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

/** How many error lines of the failed log to carry as evidence. */
const MAX_EVIDENCE = 10;

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are what this strips.
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * The lines of `gh run view --log-failed` that say what broke. Each line is
 * `job<TAB>step<TAB>timestamp text`; Actions marks the cause with `##[error]`,
 * and everything else is setup and cleanup noise — the tail of the log is
 * usually `git config` housekeeping, not the failure. The generic
 * "Process completed with exit code N" is dropped when anything else is there.
 */
export function errorLines(log: string): string[] {
  const lines = log
    .split("\n")
    .map((line) => {
      const [job = "", , rest = ""] = line.split("\t");
      const text = rest
        .replace(ANSI, "")
        .replace(/^\S+Z /, "")
        .trim();
      return { job, text };
    })
    .filter(({ text }) => text.startsWith("##[error]"))
    .map(({ job, text }) => `${job}: ${text.slice("##[error]".length)}`);
  const specific = lines.filter(
    (l) => !/Process completed with exit code/.test(l),
  );
  const kept = specific.length > 0 ? specific : lines;
  return [...new Set(collapseRepeats(kept, (l) => l, markRepeat))].slice(
    0,
    MAX_EVIDENCE,
  );
}

/** Triage a workflow run from its job list and the error lines of its failed log. */
export function triageWorkflowRun(
  run: GhRun,
  log = "",
): Triage & {
  run: number;
  workflow: string;
  branch: string;
  url: string;
  failedJobs: { name: string; failedSteps: string[]; url: string }[];
} {
  const id = run.databaseId ?? 0;
  const failedJobs = (run.jobs ?? [])
    .filter((j) => FAILED.has(j.conclusion ?? ""))
    .map((j) => ({
      name: j.name ?? "",
      failedSteps: (j.steps ?? [])
        .filter((s) => FAILED.has(s.conclusion ?? ""))
        .map((s) => s.name ?? ""),
      url: j.url ?? "",
    }));

  const likelyCauses = failedJobs.map((j) =>
    j.failedSteps.length > 0
      ? `Job '${j.name}' failed at step '${j.failedSteps.join("', '")}'.`
      : `Job '${j.name}' failed.`,
  );
  const status =
    run.status !== "completed"
      ? `InProgress (${run.status ?? "unknown"})`
      : run.conclusion === "success"
        ? "Healthy"
        : (run.conclusion ?? "Unknown");
  if (status === "cancelled") likelyCauses.push("The run was cancelled.");

  return {
    status,
    run: id,
    workflow: run.name ?? "",
    branch: run.headBranch ?? "",
    url: run.url ?? "",
    failedJobs,
    likelyCauses,
    // A suggestion must be a bash-mcp call (src/diagnostic.test.ts) and none
    // reads a raw log; the error lines are the evidence and `url` the rest.
    suggestedNextCommands: [],
    evidence: errorLines(log),
  };
}
