import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import type { ListFormat } from "#format";
import { okList } from "#response";
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
      equivalentCommands: ["git branch -a"],
      inputSchema: {
        cwd: z.string().optional().describe("Repository path"),
        remote: z.boolean().optional().describe("Include remote branches"),
        format: z
          .enum(["json", "tsv", "columnar", "bare"])
          .optional()
          .describe("Output format (default: tsv)"),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            "Limit the text view to these columns (structuredContent keeps all)",
          ),
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
    async ({ cwd, remote, format, fields }) => {
      const fmt = (format ?? "tsv") as ListFormat;
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

      // Drop the all-false `remote` column from the text view unless remotes
      // were requested; structuredContent keeps it for schema completeness.
      const rows = branches.map(({ name, current, lastCommit, ...rest }) =>
        remote
          ? { name, current, lastCommit, remote: rest.remote }
          : { name, current, lastCommit },
      );
      return okList(
        { current: currentBranch, branches },
        rows,
        { current: currentBranch },
        fmt,
        { fields },
      );
    },
  );
}
