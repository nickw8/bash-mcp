/**
 * GitHub Tools
 *
 * Wraps the `gh` CLI for the two questions an agent asks about CI: "are this
 * PR's checks green?" and "why did the run fail?". Both read gh's `--json`
 * output; the failure summary is a Diagnostic tool (Triage envelope).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyError } from "#error";
import { exec, execJson, TIMEOUT } from "#exec";
import { isUnrunnable, triageSchema, unknownTriage } from "#parsers";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import {
  type GhCheck,
  type GhRun,
  summarizeChecks,
  triageWorkflowRun,
} from "./parse.js";

const cwdSchema = z
  .string()
  .optional()
  .describe("Repository path (default: the server's working directory)");

const RUN_FIELDS =
  "databaseId,name,displayTitle,headBranch,status,conclusion,url,jobs";

/** Register all GitHub tools on the MCP server. */
export function registerGithubTools(server: McpServer) {
  // ── gh pr checks ────────────────────────────────────────────────────
  defineTool(
    server,
    "gh_pr_checks",
    {
      title: "PR checks",
      description:
        "Report a pull request's CI checks as counts per state plus the failing and pending checks. " +
        "Defaults to the current branch's PR; passing checks are counted, not listed, unless all=true.",
      equivalentCommands: ["gh pr checks"],
      inputSchema: {
        pr: z
          .string()
          .optional()
          .describe(
            "PR number, URL or branch (default: the current branch's PR)",
          ),
        all: z
          .boolean()
          .optional()
          .describe(
            "List passing and skipped checks too (default: only the rest)",
          ),
        cwd: cwdSchema,
      },
      outputSchema: {
        checks: z.array(
          z.object({
            name: z.string(),
            workflow: z.string(),
            bucket: z.string(),
            link: z.string(),
          }),
        ),
        counts: z.object({
          pass: z.number(),
          fail: z.number(),
          pending: z.number(),
          skipping: z.number(),
          cancel: z.number(),
        }),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ pr, all, cwd }) => {
      const args = ["pr", "checks", ...(pr ? [pr] : [])];
      // gh exits 1 when a check failed and 8 while any is pending, with the
      // JSON still on stdout — so the exit code is not the failure signal.
      const result = await exec(
        "gh",
        [...args, "--json", "name,workflow,bucket,link"],
        { cwd, timeout: TIMEOUT.INFRA },
      );
      let checks: GhCheck[];
      try {
        checks = JSON.parse(result.stdout) as GhCheck[];
      } catch {
        const detail = classifyError(result, "gh");
        return err(detail.message, {}, detail);
      }
      return ok(summarizeChecks(checks, all));
    },
  );

  // ── workflow run failure triage ─────────────────────────────────────
  defineTool(
    server,
    "gh_run_failure_summary",
    {
      diagnostic: true,
      title: "CI run failure summary",
      description:
        "Diagnose a GitHub Actions run in one call: status, the failed jobs and steps, and the " +
        "##[error] lines from the failed log as evidence. Defaults to the latest run on the current branch.",
      equivalentCommands: [
        "gh run list --branch <branch> -L 1",
        "gh run view <run> --json jobs",
        "gh run view <run> --log-failed",
      ],
      inputSchema: {
        run: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Run ID (default: the latest run on `branch`)"),
        branch: z
          .string()
          .optional()
          .describe(
            "Branch whose latest run to read (default: the current branch)",
          ),
        cwd: cwdSchema,
      },
      outputSchema: {
        run: z.number(),
        workflow: z.string(),
        branch: z.string(),
        url: z.string(),
        failedJobs: z.array(
          z.object({
            name: z.string(),
            failedSteps: z.array(z.string()),
            url: z.string(),
          }),
        ),
        ...triageSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ run, branch, cwd }) => {
      const empty = {
        run: 0,
        workflow: "",
        branch: "",
        url: "",
        failedJobs: [],
      };
      const opts = { cwd, timeout: TIMEOUT.INFRA };

      let id = run === undefined ? undefined : String(run);
      if (id === undefined) {
        const target =
          branch ??
          (
            await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts)
          ).stdout.trim();
        const list = await execJson<{ databaseId: number }[]>(
          "gh",
          [
            "run",
            "list",
            "-L",
            "1",
            "--json",
            "databaseId",
            ...(target ? ["--branch", target] : []),
          ],
          opts,
        );
        if (list.error !== null && isUnrunnable(list.detail)) {
          return err(list.error, empty, list.detail);
        }
        const latest = list.data?.[0]?.databaseId;
        if (latest === undefined) {
          return ok({
            ...empty,
            branch: target,
            ...unknownTriage(
              list.error
                ? `gh run list failed: ${list.error}`
                : `no workflow runs found for branch '${target}'`,
            ),
          });
        }
        id = String(latest);
      }

      const view = await execJson<GhRun>(
        "gh",
        ["run", "view", id, "--json", RUN_FIELDS],
        opts,
      );
      if (view.error !== null && isUnrunnable(view.detail)) {
        return err(view.error, empty, view.detail);
      }
      if (view.data === null) {
        return ok({
          ...empty,
          ...unknownTriage(
            `gh run view ${id} failed: ${view.error ?? "no data"}`,
          ),
        });
      }
      // The failed log is best-effort evidence: a run still in progress, or
      // one whose logs expired, has none, and that shouldn't fail the triage.
      const conclusion = view.data.conclusion;
      const log =
        conclusion && conclusion !== "success"
          ? (
              await exec("gh", ["run", "view", id, "--log-failed"], {
                ...opts,
                timeout: TIMEOUT.DEFAULT,
              })
            ).stdout
          : "";
      return ok(triageWorkflowRun(view.data, log));
    },
  );
}
