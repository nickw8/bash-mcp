/**
 * Pure GitLab CLI parsers: `glab ci get --output json` into counted jobs, and
 * that pipeline plus `glab ci trace` into a CI-failure Triage. Pure and
 * fixture-tested; never throws on missing fields.
 */

import type { Triage } from "#parsers";
import { collapseRepeats, lineKey, markRepeat } from "#shape";

/** The subset of `glab ci get --output json` the tools read. */
export interface GlabPipeline {
  id?: number;
  status?: string;
  ref?: string;
  web_url?: string;
  jobs?: GlabJob[];
}

export interface GlabJob {
  id?: number;
  name?: string;
  stage?: string;
  status?: string;
  allow_failure?: boolean;
  failure_reason?: string;
  web_url?: string;
}

/** Job states that need nothing from the reader: a count, not a row. */
const QUIET = new Set(["success", "skipped", "manual"]);

/** Pipeline states that mean it has not finished yet. */
const RUNNING = new Set([
  "created",
  "waiting_for_resource",
  "preparing",
  "pending",
  "running",
  "scheduled",
]);

/** A failed job whose failure GitLab lets the pipeline pass anyway. */
const tolerated = (j: GlabJob) => j.status === "failed" && j.allow_failure;

/** Count jobs per status and keep the rows worth reading, unless `all`. */
export function summarizeJobs(pipeline: GlabPipeline, all = false) {
  const jobs = pipeline.jobs ?? [];
  const counts: Record<string, number> = {};
  for (const j of jobs) {
    const status = j.status ?? "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return {
    pipeline: pipeline.id ?? 0,
    status: pipeline.status ?? "",
    url: pipeline.web_url ?? "",
    counts,
    jobs: jobs
      .filter((j) => all || !QUIET.has(j.status ?? ""))
      .map((j) => ({
        name: j.name ?? "",
        stage: j.stage ?? "",
        status: j.status ?? "",
        allowFailure: j.allow_failure ?? false,
        url: j.web_url ?? "",
      })),
  };
}

/** The jobs that broke the pipeline (an allowed failure did not). */
export function failedJobsOf(pipeline: GlabPipeline): GlabJob[] {
  return (pipeline.jobs ?? []).filter(
    (j) => j.status === "failed" && !tolerated(j),
  );
}

/** How many trailing script lines of a failed job's trace to keep. */
const MAX_TAIL = 6;

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are what this strips.
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
/** Runner line prefix: `2026-10-19T12:33:42.234838Z 01O+` (absent on old runners). */
const PREFIX = /^\S+Z \d+[OE]\+?\s?/;

/**
 * The lines of a `glab ci trace` that say what broke. GitLab has no error
 * marker like Actions' `##[error]`, so this keeps the tail of the job's own
 * script — the `step_script` section, before artifact upload and cleanup —
 * minus echoed `$ command` lines, plus the runner's `ERROR: Job failed` line.
 */
export function traceTail(trace: string): string[] {
  const lines = trace
    .split(/\r?\n|\r/)
    .map((l) => l.replace(ANSI, "").replace(PREFIX, "").trim());
  const start = lines.findIndex((l) =>
    /^section_start:\d+:step_script/.test(l),
  );
  const end = lines.findIndex((l) => /^section_end:\d+:step_script/.test(l));
  const script =
    start >= 0 ? lines.slice(start + 1, end > start ? end : undefined) : lines;
  const tail = collapseRepeats(
    script.filter((l) => l && !l.startsWith("$ ") && !l.startsWith("section_")),
    lineKey,
    markRepeat,
  ).slice(-MAX_TAIL);
  const failed = lines.find((l) => l.startsWith("ERROR: Job failed"));
  return failed ? [...tail, failed] : tail;
}

/** Triage a pipeline from its jobs and the traces of its failed jobs (by job id). */
export function triagePipeline(
  pipeline: GlabPipeline,
  traces: Map<number, string> = new Map(),
): Triage & {
  pipeline: number;
  branch: string;
  url: string;
  failedJobs: {
    name: string;
    stage: string;
    failureReason: string;
    url: string;
  }[];
} {
  const failed = failedJobsOf(pipeline);
  const failedJobs = failed.map((j) => ({
    name: j.name ?? "",
    stage: j.stage ?? "",
    failureReason: j.failure_reason ?? "",
    url: j.web_url ?? "",
  }));
  const likelyCauses = failedJobs.map(
    (j) =>
      `Job '${j.name}' (stage ${j.stage}) failed${j.failureReason ? `: ${j.failureReason}` : ""}.`,
  );
  const allowed = (pipeline.jobs ?? []).filter(tolerated);
  if (allowed.length > 0) {
    likelyCauses.push(
      `Allowed to fail, not blocking: ${allowed.map((j) => j.name).join(", ")}.`,
    );
  }
  const raw = pipeline.status ?? "";
  const status =
    raw === "success"
      ? "Healthy"
      : RUNNING.has(raw)
        ? `InProgress (${raw})`
        : raw || "Unknown";

  return {
    status,
    pipeline: pipeline.id ?? 0,
    branch: pipeline.ref ?? "",
    url: pipeline.web_url ?? "",
    failedJobs,
    likelyCauses,
    // A suggestion must be a bash-mcp call (src/diagnostic.test.ts) and none
    // reads a raw trace; the trace tails are the evidence and `url` the rest.
    suggestedNextCommands: [],
    evidence: failed.flatMap((j) =>
      traceTail(traces.get(j.id ?? -1) ?? "").map((l) => `${j.name}: ${l}`),
    ),
  };
}
