/**
 * git_pr_context — the commits and file changes on a branch relative to a base,
 * shaped for writing a PR description. Collapses log + diff (name-status +
 * shortstat) over the base...head range.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { ok } from "#response";
import { defineTool } from "#tool";
import {
  COMMIT_FORMAT,
  parseCommits,
  parseNameStatus,
  parseShortstat,
} from "./parse.js";

/** Register the git_pr_context tool. */
export function registerGitPrContextTool(server: McpServer) {
  defineTool(
    server,
    "git_pr_context",
    {
      title: "Git PR context",
      equivalentCommands: [
        "git log <base>..<head>",
        "git diff --name-status <base>...<head>",
        "git diff --stat <base>...<head>",
      ],
      description:
        "Collect the commits and file changes of a branch vs a base ref (for writing a PR " +
        "description): commit list, changed files with status, and a diffstat over base...head.",
      inputSchema: {
        cwd: z.string().optional().describe("Repository path"),
        base: z
          .string()
          .optional()
          .default("main")
          .describe("Base ref to compare against (default 'main')"),
        head: z
          .string()
          .optional()
          .default("HEAD")
          .describe("Head ref (default 'HEAD')"),
      },
      outputSchema: {
        base: z.string(),
        head: z.string(),
        commits: z.array(
          z.object({
            hash: z.string(),
            shortHash: z.string(),
            author: z.string(),
            date: z.string(),
            message: z.string(),
          }),
        ),
        files: z.array(z.object({ status: z.string(), file: z.string() })),
        changes: z.object({
          files: z.number(),
          insertions: z.number(),
          deletions: z.number(),
        }),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, base, head }) => {
      const opts = cwd ? { cwd } : {};
      const b = base ?? "main";
      const h = head ?? "HEAD";

      const logRes = await exec(
        "git",
        ["log", `--format=${COMMIT_FORMAT}`, `${b}..${h}`],
        opts,
      );
      const commits = parseCommits(logRes.stdout);

      const filesRes = await exec(
        "git",
        ["diff", "--name-status", `${b}...${h}`],
        opts,
      );
      const files = parseNameStatus(filesRes.stdout);

      const statRes = await exec(
        "git",
        ["diff", "--shortstat", `${b}...${h}`],
        opts,
      );
      const changes = parseShortstat(statRes.stdout);

      return ok({ base: b, head: h, commits, files, changes });
    },
  );
}
