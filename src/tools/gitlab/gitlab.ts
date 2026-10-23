/**
 * GitLab Tools
 *
 * Wraps the `glab` CLI for the two questions an agent asks about CI: "is this
 * pipeline green?" and "why did it fail?". Both read one `glab ci get --output
 * json` call; the failure summary is a Diagnostic tool (Triage envelope) that
 * adds the tail of each failed job's trace.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, execJson, TIMEOUT } from "#exec";
import { isUnrunnable, triageSchema, unknownTriage } from "#parsers";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import {
  failedJobsOf,
  type GlabPipeline,
  summarizeJobs,
  triagePipeline,
} from "./parse.js";

/** How many failed jobs' traces to fetch; the rest are named, not read. */
const MAX_TRACED = 3;

const targetSchema = {
  pipeline: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Pipeline ID (default: the latest pipeline on `branch`)"),
  mr: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Merge request IID: read its head pipeline instead"),
  branch: z
    .string()
    .optional()
    .describe("Branch whose latest pipeline to read (default: current branch)"),
  repo: z
    .string()
    .optional()
    .describe("GROUP/REPO or URL (default: the repo at `cwd`)"),
  cwd: z
    .string()
    .optional()
    .describe("Repository path (default: the server's working directory)"),
};

type Target = {
  pipeline?: string | number;
  mr?: string | number;
  branch?: string;
  repo?: string;
};

const repoArgs = (repo?: string) => (repo ? ["-R", repo] : []);

/** `glab ci get` args for the pipeline a call names, most specific first. */
function ciGetArgs({ pipeline, mr, branch, repo }: Target): string[] {
  const which =
    pipeline !== undefined
      ? ["-p", String(pipeline)]
      : mr !== undefined
        ? ["--merge-request", String(mr)]
        : branch
          ? ["-b", branch]
          : [];
  return ["ci", "get", "--output", "json", ...which, ...repoArgs(repo)];
}

/** Register all GitLab tools on the MCP server. */
export function registerGitlabTools(server: McpServer) {
  // ── pipeline job status ─────────────────────────────────────────────
  defineTool(
    server,
    "glab_ci_status",
    {
      title: "GitLab pipeline status",
      description:
        "Report a GitLab pipeline's jobs as counts per status plus the failed, running and pending jobs. " +
        "Defaults to the current branch's latest pipeline; pass mr for a merge request's head pipeline. " +
        "Passing, skipped and manual jobs are counted, not listed, unless all=true.",
      equivalentCommands: ["glab ci get", "glab ci status"],
      inputSchema: {
        ...targetSchema,
        all: z
          .boolean()
          .optional()
          .describe("List passing, skipped and manual jobs too"),
      },
      outputSchema: {
        pipeline: z.number(),
        status: z.string(),
        url: z.string(),
        counts: z.record(z.number()),
        jobs: z.array(
          z.object({
            name: z.string(),
            stage: z.string(),
            status: z.string(),
            allowFailure: z.boolean(),
            url: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ all, cwd, ...target }) => {
      const res = await execJson<GlabPipeline>("glab", ciGetArgs(target), {
        cwd,
        timeout: TIMEOUT.INFRA,
      });
      if (res.data === null) {
        return err(res.error ?? "glab ci get returned no data", {}, res.detail);
      }
      return ok(summarizeJobs(res.data, all));
    },
  );

  // ── pipeline failure triage ─────────────────────────────────────────
  defineTool(
    server,
    "glab_pipeline_failure_summary",
    {
      diagnostic: true,
      title: "GitLab pipeline failure summary",
      description:
        "Diagnose a GitLab pipeline in one call: status, the failed jobs and why GitLab says they failed, " +
        "and the last script lines of each failed job's trace as evidence. Allowed-to-fail jobs are noted, " +
        "not counted as the failure. Defaults to the current branch's latest pipeline.",
      equivalentCommands: ["glab ci get --output json", "glab ci trace <job>"],
      inputSchema: targetSchema,
      outputSchema: {
        pipeline: z.number(),
        branch: z.string(),
        url: z.string(),
        failedJobs: z.array(
          z.object({
            name: z.string(),
            stage: z.string(),
            failureReason: z.string(),
            url: z.string(),
          }),
        ),
        ...triageSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, ...target }) => {
      const empty = { pipeline: 0, branch: "", url: "", failedJobs: [] };
      const res = await execJson<GlabPipeline>("glab", ciGetArgs(target), {
        cwd,
        timeout: TIMEOUT.INFRA,
      });
      if (res.error !== null && isUnrunnable(res.detail)) {
        return err(res.error, empty, res.detail);
      }
      if (res.data === null) {
        return ok({
          ...empty,
          ...unknownTriage(`glab ci get failed: ${res.error ?? "no data"}`),
        });
      }
      // Traces are best-effort evidence: an erased or oversized log shouldn't
      // fail the triage, it just leaves that job without evidence lines.
      const traced = failedJobsOf(res.data).slice(0, MAX_TRACED);
      const traces = new Map(
        await Promise.all(
          traced.map(
            async (j) =>
              [
                j.id ?? -1,
                (
                  await exec(
                    "glab",
                    ["ci", "trace", String(j.id), ...repoArgs(target.repo)],
                    { cwd, timeout: TIMEOUT.DEFAULT },
                  )
                ).stdout,
              ] as const,
          ),
        ),
      );
      return ok(triagePipeline(res.data, traces));
    },
  );
}
