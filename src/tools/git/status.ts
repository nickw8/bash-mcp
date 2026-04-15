import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { ok } from "#response";

/** Register the git_status tool for structured working tree status. */
export function registerGitStatusTool(server: McpServer) {
  server.registerTool(
    "git_status",
    {
      title: "Git status",
      description:
        "Structured git status: branch, staged/unstaged/untracked files. Replaces parsing raw git status output.",
      inputSchema: {
        cwd: z.string().optional().describe("Repository path"),
      },
      outputSchema: {
        branch: z.string(),
        ahead: z.number(),
        behind: z.number(),
        staged: z.array(z.object({ file: z.string(), status: z.string() })),
        unstaged: z.array(z.object({ file: z.string(), status: z.string() })),
        untracked: z.array(z.string()),
        clean: z.boolean(),
      },
    },
    async ({ cwd }) => {
      const opts = cwd ? { cwd } : {};

      const [statusResult, branchResult] = await Promise.all([
        exec("git", ["status", "--porcelain=v2", "--branch"], opts),
        exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts),
      ]);

      const lines = statusResult.stdout.split("\n").filter(Boolean);
      let branch = branchResult.stdout.trim();
      let ahead = 0;
      let behind = 0;
      const staged: { file: string; status: string }[] = [];
      const unstaged: { file: string; status: string }[] = [];
      const untracked: string[] = [];

      // Git porcelain v2 XY status codes -> human-readable labels
      const statusMap: Record<string, string> = {
        M: "modified",
        A: "added",
        D: "deleted",
        R: "renamed",
        C: "copied",
      };

      for (const line of lines) {
        if (line.startsWith("# branch.head ")) {
          branch = line.slice("# branch.head ".length);
        } else if (line.startsWith("# branch.ab ")) {
          const match = line.match(/\+(\d+) -(\d+)/);
          if (match) {
            ahead = parseInt(match[1]!, 10);
            behind = parseInt(match[2]!, 10);
          }
        } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
          const parts = line.split(" ");
          const xy = parts[1] ?? "..";
          const file = parts.at(-1) ?? "";
          if (xy[0] !== ".")
            staged.push({ file, status: statusMap[xy[0]!] ?? xy[0]! });
          if (xy[1] !== ".")
            unstaged.push({ file, status: statusMap[xy[1]!] ?? xy[1]! });
        } else if (line.startsWith("? ")) {
          untracked.push(line.slice(2));
        }
      }

      const clean =
        staged.length === 0 && unstaged.length === 0 && untracked.length === 0;
      return ok({ branch, ahead, behind, staged, unstaged, untracked, clean });
    },
  );
}
