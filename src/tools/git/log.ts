import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import type { ListFormat } from "#format";
import { okList } from "#response";
import { defineTool } from "#tool";

/** Register the git_log tool for structured commit history. */
export function registerGitLogTool(server: McpServer) {
  defineTool(
    server,
    "git_log",
    {
      title: "Git log",
      description:
        "Structured git log: commit hash, author, date, message. Compact and parseable. " +
        "Use range for ref comparisons (e.g. 'main..feature'). " +
        "Use exclude to filter out commits matching a pattern (e.g. 'ci:').",
      inputSchema: {
        cwd: z.string().optional().describe("Repository path"),
        count: z
          .number()
          .optional()
          .default(20)
          .describe("Number of commits (default 20)"),
        author: z.string().optional().describe("Filter by author"),
        since: z.string().optional().describe("Since date (e.g. '2024-01-01')"),
        path: z.string().optional().describe("Filter by file path"),
        range: z
          .string()
          .optional()
          .describe("Git ref range (e.g. 'main..feature', 'HEAD~5..HEAD')"),
        exclude: z
          .string()
          .optional()
          .describe(
            "Exclude commits matching this grep pattern (uses --invert-grep)",
          ),
        withFiles: z
          .boolean()
          .optional()
          .describe("Include list of files changed per commit"),
        format: z
          .enum(["json", "tsv", "columnar", "bare"])
          .optional()
          .describe("Output format (default: tsv)"),
      },
      outputSchema: {
        commits: z.array(
          z.object({
            hash: z.string(),
            shortHash: z.string(),
            author: z.string(),
            date: z.string(),
            message: z.string(),
            files: z.array(z.string()).optional(),
          }),
        ),
        count: z.number(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      cwd,
      count,
      author,
      since,
      path,
      range,
      exclude,
      withFiles,
      format,
    }) => {
      const fmt = (format ?? "tsv") as ListFormat;
      // Unicode separator avoids collisions with commit message content
      const sep = "\u2016";
      const args = [
        "log",
        `--format=%H${sep}%h${sep}%an${sep}%aI${sep}%s`,
        `-n`,
        String(count ?? 20),
      ];
      if (withFiles) args.push("--name-only");
      if (author) args.push(`--author=${author}`);
      if (since) args.push(`--since=${since}`);
      if (exclude) args.push("--invert-grep", `--grep=${exclude}`);
      if (range) args.push(range);
      if (path) {
        args.push("--");
        args.push(path);
      }

      const result = await exec("git", args, cwd ? { cwd } : {});

      let commits: {
        hash: string;
        shortHash: string;
        author: string;
        date: string;
        message: string;
        files?: string[];
      }[];

      if (withFiles) {
        // With --name-only, output is: <formatted line>\n\nfile1\nfile2\n\n<next formatted line>...
        // Split on the commit format lines using the separator as anchor
        commits = [];
        const blocks = result.stdout.trim().split(/\n(?=[0-9a-f]{40}\u2016)/);
        for (const block of blocks) {
          if (!block) continue;
          const lines = block.split("\n");
          const commitLine = lines[0] ?? "";
          const [hash, shortHash, authorName, date, ...msgParts] =
            commitLine.split(sep);
          const files = lines.slice(1).filter(Boolean);
          commits.push({
            hash: hash ?? "",
            shortHash: shortHash ?? "",
            author: authorName ?? "",
            date: date ?? "",
            message: msgParts.join(sep),
            files,
          });
        }
      } else {
        commits = result.stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [hash, shortHash, authorName, date, ...msgParts] =
              line.split(sep);
            return {
              hash: hash ?? "",
              shortHash: shortHash ?? "",
              author: authorName ?? "",
              date: date ?? "",
              message: msgParts.join(sep),
            };
          });
      }

      // Text view keeps shortHash (the full hash is a redundant prefix);
      // structuredContent retains both. Files (if any) collapse to one cell.
      const rows = commits.map((c) => ({
        shortHash: c.shortHash,
        author: c.author,
        date: c.date,
        message: c.message,
        ...(withFiles ? { files: (c.files ?? []).join(",") } : {}),
      }));
      return okList(
        { commits, count: commits.length },
        rows,
        {
          count: commits.length,
        },
        fmt,
      );
    },
  );
}
