/**
 * repo_health_summary — one-call snapshot of a repo's working state:
 * branch, ahead/behind vs upstream, staged/unstaged/untracked counts, recent
 * commits, and an uncommitted-change diffstat. Collapses status + log + diff.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { ok } from "#response";
import { defineTool } from "#tool";
import {
  COMMIT_FORMAT,
  parseBranchStatus,
  parseCommits,
  parseShortstat,
} from "./parse.js";

/** Register the repo_health_summary tool. */
export function registerRepoHealthTool(server: McpServer) {
  defineTool(
    server,
    "repo_health_summary",
    {
      title: "Repo health summary",
      description:
        "One-call snapshot of a git working tree: branch, ahead/behind vs upstream, " +
        "staged/unstaged/untracked counts, recent commits, and the uncommitted diffstat.",
      inputSchema: {
        cwd: z.string().optional().describe("Repository path"),
        commits: z
          .number()
          .optional()
          .default(5)
          .describe("Number of recent commits to include (default 5)"),
      },
      outputSchema: {
        branch: z.string(),
        ahead: z.number(),
        behind: z.number(),
        staged: z.number(),
        unstaged: z.number(),
        untracked: z.number(),
        clean: z.boolean(),
        recentCommits: z.array(
          z.object({
            hash: z.string(),
            shortHash: z.string(),
            author: z.string(),
            date: z.string(),
            message: z.string(),
          }),
        ),
        changes: z.object({
          files: z.number(),
          insertions: z.number(),
          deletions: z.number(),
        }),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, commits }) => {
      const opts = cwd ? { cwd } : {};

      const statusRes = await exec(
        "git",
        ["status", "-b", "--porcelain=v2"],
        opts,
      );
      const status = parseBranchStatus(statusRes.stdout);

      const logRes = await exec(
        "git",
        ["log", `--format=${COMMIT_FORMAT}`, "-n", String(commits ?? 5)],
        opts,
      );
      const recentCommits = parseCommits(logRes.stdout);

      const diffRes = await exec("git", ["diff", "--shortstat", "HEAD"], opts);
      const changes = parseShortstat(diffRes.stdout);

      return ok({ ...status, recentCommits, changes });
    },
  );
}
