import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { ok } from "#response";
import { defineTool } from "#tool";

/** Register the git_branches tool for structured branch listing. */
export function registerGitBranchesTool(server: McpServer) {
  defineTool(
    server,
    "git_branches",
    {
      title: "Git branches",
      description:
        "List git branches with current branch marker and last commit info.",
      inputSchema: {
        cwd: z.string().optional().describe("Repository path"),
        remote: z.boolean().optional().describe("Include remote branches"),
      },
      outputSchema: {
        current: z.string(),
        branches: z.array(
          z.object({
            name: z.string(),
            current: z.boolean(),
            lastCommit: z.string(),
            remote: z.boolean(),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, remote }) => {
      const args = ["branch", "-v", "--no-color"];
      if (remote) args.push("-a");

      const result = await exec("git", args, cwd ? { cwd } : {});

      let currentBranch = "";
      const branches = result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const isCurrent = line.startsWith("* ");
          const cleaned = line.replace(/^[* ] +/, "");
          const parts = cleaned.split(/\s+/);
          const name = parts[0] ?? "";
          const lastCommit = parts.slice(1).join(" ");
          const isRemote = name.startsWith("remotes/");
          if (isCurrent) currentBranch = name;
          return { name, current: isCurrent, lastCommit, remote: isRemote };
        });

      return ok({ current: currentBranch, branches });
    },
  );
}
