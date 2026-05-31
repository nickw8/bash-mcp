import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { ok } from "#response";
import { defineTool } from "#tool";

/** Register the git_diff tool for structured file-level diff statistics. */
export function registerGitDiffSummaryTool(server: McpServer) {
  defineTool(
    server,
    "git_diff",
    {
      title: "Git diff",
      description:
        "Structured git diff: files changed with insertions/deletions counts. " +
        "Use base+ref for two-ref comparison (e.g. base='main', ref='feature'). " +
        "Use path to scope to a specific file or directory.",
      inputSchema: {
        cwd: z.string().optional().describe("Repository path"),
        ref: z
          .string()
          .optional()
          .describe("Ref to diff against (e.g. 'main', 'HEAD~3')"),
        base: z
          .string()
          .optional()
          .describe(
            "Base ref for two-ref comparison. When both ref and base are set, runs git diff <base> <ref>",
          ),
        staged: z.boolean().optional().describe("Show staged changes"),
        path: z
          .string()
          .optional()
          .describe("Limit diff to a specific file or directory"),
      },
      outputSchema: {
        files: z.array(
          z.object({
            file: z.string(),
            insertions: z.number(),
            deletions: z.number(),
          }),
        ),
        totalInsertions: z.number(),
        totalDeletions: z.number(),
        fileCount: z.number(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, ref, base, staged, path }) => {
      const args = ["diff", "--numstat"];
      if (staged) args.push("--cached");
      if (base && ref) {
        args.push(base, ref);
      } else if (ref) {
        args.push(ref);
      }
      if (path) {
        args.push("--");
        args.push(path);
      }

      const result = await exec("git", args, cwd ? { cwd } : {});

      const files = result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [ins, del, ...fileParts] = line.split("\t");
          return {
            file: fileParts.join("\t"),
            insertions: ins === "-" ? 0 : parseInt(ins ?? "0", 10),
            deletions: del === "-" ? 0 : parseInt(del ?? "0", 10),
          };
        });

      const totalInsertions = files.reduce((sum, f) => sum + f.insertions, 0);
      const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
      return ok({
        files,
        totalInsertions,
        totalDeletions,
        fileCount: files.length,
      });
    },
  );
}
