/**
 * Git Diff Content Tool
 *
 * Returns structured patch/diff content with parsed hunks per file.
 * Unlike the git_diff tool (which returns numstat), this returns actual
 * code changes in a structured format.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { exec } from "#exec";
import { ok, err } from "#response";

/** Parse unified diff output into structured per-file sections with hunks. */
export function parseDiff(raw: string) {
  const files: {
    path: string;
    insertions: number;
    deletions: number;
    hunks: { header: string; lines: string }[];
  }[] = [];

  // Split into per-file sections by "diff --git" markers
  const fileSections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    // Extract file path from "+++ b/..." line (handles renames correctly)
    const pppMatch = section.match(/^\+\+\+ b\/(.+)$/m);
    // Fallback: extract from the diff --git header
    const headerMatch = section.match(/^a\/.+ b\/(.+)$/m);
    const filePath = pppMatch?.[1] ?? headerMatch?.[1] ?? "unknown";

    const hunks: { header: string; lines: string }[] = [];
    let fileInsertions = 0;
    let fileDeletions = 0;

    // Split section into hunks by @@ markers
    const hunkParts = section.split(/^(@@[^@]*@@.*$)/m);

    // hunkParts alternates: [preamble, header1, body1, header2, body2, ...]
    for (let i = 1; i < hunkParts.length; i += 2) {
      const header = hunkParts[i]!.trim();
      const body = hunkParts[i + 1] ?? "";

      const bodyLines = body.split("\n");
      // Filter out empty trailing line from the split
      const contentLines: string[] = [];
      for (const line of bodyLines) {
        // Skip empty lines that are just split artifacts at the end
        if (line === "" && contentLines.length === 0) continue;
        contentLines.push(line);
      }

      // Count insertions and deletions (exclude +++ and --- header lines)
      for (const line of contentLines) {
        if (line.startsWith("+") && !line.startsWith("+++")) fileInsertions++;
        if (line.startsWith("-") && !line.startsWith("---")) fileDeletions++;
      }

      // Join lines back, trimming trailing empty line
      const linesText = contentLines.join("\n").replace(/\n$/, "");
      hunks.push({ header, lines: linesText });
    }

    files.push({
      path: filePath,
      insertions: fileInsertions,
      deletions: fileDeletions,
      hunks,
    });
  }

  const summary = {
    filesChanged: files.length,
    insertions: files.reduce((sum, f) => sum + f.insertions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
  };

  return { files, summary };
}

/** Register the git_diff_content tool on the MCP server. */
export function registerGitDiffContentTools(server: McpServer) {
  server.registerTool("git_diff_content", {
    title: "Git diff with content",
    description:
      "Show git diff with structured patch content. Returns parsed hunks per file instead of raw unified diff text. Use this when you need to see actual code changes, not just file-level stats.",
    inputSchema: {
      cwd: z.string().optional().describe("Working directory (git repo)"),
      ref: z.string().optional().describe("Diff against this ref (e.g. 'HEAD~1', 'main', a commit hash)"),
      staged: z.boolean().optional().default(false).describe("Show staged changes (--cached)"),
      path: z.string().optional().describe("Limit diff to a specific file or directory"),
      context: z.number().optional().default(3).describe("Number of context lines around changes (passed as -U<n>)"),
    },
    outputSchema: {
      files: z.array(
        z.object({
          path: z.string(),
          insertions: z.number(),
          deletions: z.number(),
          hunks: z.array(
            z.object({
              header: z.string(),
              lines: z.string(),
            }),
          ),
        }),
      ),
      summary: z.object({
        filesChanged: z.number(),
        insertions: z.number(),
        deletions: z.number(),
      }),
    },
  }, async ({ cwd, ref, staged, path, context }) => {
    const args = ["diff", `-U${context ?? 3}`];
    if (staged) args.push("--cached");
    if (ref) args.push(ref);
    if (path) { args.push("--"); args.push(path); }

    const result = await exec("git", args, cwd ? { cwd } : {});

    if (result.exitCode !== 0) {
      return err(result.stderr || result.stdout, {
        files: [],
        summary: { filesChanged: 0, insertions: 0, deletions: 0 },
      });
    }

    // Empty diff (no changes)
    if (!result.stdout.trim()) {
      return ok({
        files: [],
        summary: { filesChanged: 0, insertions: 0, deletions: 0 },
      });
    }

    const parsed = parseDiff(result.stdout);
    return ok(parsed);
  });
}
