/**
 * Search Tools
 *
 * Wraps ripgrep (rg) for content search and glob-based file matching.
 * Uses rg's JSON output mode to return structured match data instead
 * of line-oriented text.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import type { ListFormat } from "#format";
import { err, okList } from "#response";

/** Register all search tools on the MCP server. */
export function registerSearchTools(server: McpServer) {
  // ── rg (ripgrep) ────────────────────────────────────────────────────
  server.registerTool(
    "rg",
    {
      title: "Ripgrep search",
      description:
        "Search file contents with ripgrep. Returns structured matches with file, line number, and matched text. Far more compact than raw rg output. " +
        "Use glob to filter by file type (e.g. '*.ts'), ignoreCase for case-insensitive search, " +
        "filesOnly for just filenames, or countPerFile for match counts per file.",
      inputSchema: {
        pattern: z.string().describe("Regex pattern to search for"),
        path: z
          .string()
          .optional()
          .describe("Directory or file to search (default: cwd)"),
        glob: z.string().optional().describe("File glob filter (e.g. '*.ts')"),
        ignoreCase: z.boolean().optional().describe("Case-insensitive search"),
        maxResults: z
          .number()
          .optional()
          .default(100)
          .describe("Max results to return (default 100)"),
        context: z
          .number()
          .optional()
          .describe("Lines of context around each match"),
        filesOnly: z
          .boolean()
          .optional()
          .describe("Only return filenames, not matched lines"),
        countPerFile: z
          .boolean()
          .optional()
          .describe(
            "Return match counts grouped by file instead of individual matches",
          ),
        fixedStrings: z
          .boolean()
          .optional()
          .describe("Treat pattern as literal string"),
        format: z
          .enum(["json", "tsv", "columnar"])
          .optional()
          .describe(
            "Output format: json (default), tsv (tab-separated, most compact), columnar (keys once)",
          ),
      },
      outputSchema: {
        matches: z.array(
          z.object({
            file: z.string(),
            line: z.number(),
            text: z.string(),
          }),
        ),
        fileCount: z.number(),
        matchCount: z.number(),
        truncated: z.boolean(),
        fileCounts: z
          .array(z.object({ file: z.string(), count: z.number() }))
          .optional(),
      },
    },
    async ({
      pattern,
      path,
      glob,
      ignoreCase,
      maxResults,
      context,
      filesOnly,
      countPerFile,
      fixedStrings,
      format,
    }) => {
      const fmt = (format ?? "tsv") as ListFormat;
      const limit = maxResults ?? 100;

      if (countPerFile) {
        const args = ["--count-matches", "--no-heading"];
        if (ignoreCase) args.push("-i");
        if (glob) args.push("-g", glob);
        if (fixedStrings) args.push("-F");
        args.push(pattern);
        if (path) args.push(path);

        const result = await exec("rg", args);

        if (result.exitCode !== 0 && result.exitCode !== 1) {
          return err(result.stderr, {
            matches: [],
            fileCount: 0,
            matchCount: 0,
            truncated: false,
          });
        }

        const fileCounts: { file: string; count: number }[] = [];
        let totalMatches = 0;

        for (const line of result.stdout.trim().split("\n").filter(Boolean)) {
          const lastColon = line.lastIndexOf(":");
          if (lastColon === -1) continue;
          const file = line.slice(0, lastColon);
          const count = parseInt(line.slice(lastColon + 1), 10);
          if (Number.isNaN(count)) continue;
          fileCounts.push({ file, count });
          totalMatches += count;
        }

        const structured = {
          matches: [] as { file: string; line: number; text: string }[],
          fileCount: fileCounts.length,
          matchCount: totalMatches,
          truncated: false,
          fileCounts,
        };
        return okList(
          structured,
          fileCounts,
          { fileCount: fileCounts.length, matchCount: totalMatches },
          fmt,
        );
      }

      if (filesOnly) {
        const args = ["--files-with-matches", "--no-heading"];
        if (ignoreCase) args.push("-i");
        if (glob) args.push("-g", glob);
        if (fixedStrings) args.push("-F");
        args.push(pattern);
        if (path) args.push(path);

        const result = await exec("rg", args);
        const files = result.stdout.trim().split("\n").filter(Boolean);
        const fileRows = files.map((f) => ({ file: f }));
        const structured = {
          matches: files.map((f) => ({ file: f, line: 0, text: "" })),
          fileCount: files.length,
          matchCount: files.length,
          truncated: false,
        };
        return okList(
          structured,
          fileRows,
          { fileCount: files.length, matchCount: files.length },
          fmt,
        );
      }

      const args = ["--json", `--max-count=${Math.min(limit, 500)}`];
      if (ignoreCase) args.push("-i");
      if (glob) args.push("-g", glob);
      if (context) args.push("-C", String(context));
      if (fixedStrings) args.push("-F");
      args.push(pattern);
      if (path) args.push(path);

      const result = await exec("rg", args);

      // rg exit 1 = no matches (not an error), only fail on exit >= 2
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        return err(result.stderr, {
          matches: [],
          fileCount: 0,
          matchCount: 0,
          truncated: false,
        });
      }

      const matches: { file: string; line: number; text: string }[] = [];
      const filesSeen = new Set<string>();

      for (const line of result.stdout.split("\n").filter(Boolean)) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === "match") {
            const file = msg.data.path.text;
            filesSeen.add(file);
            if (matches.length < limit) {
              matches.push({
                file,
                line: msg.data.line_number,
                text: msg.data.lines.text.trimEnd(),
              });
            }
          }
        } catch {
          // skip malformed lines
        }
      }

      const structured = {
        matches,
        fileCount: filesSeen.size,
        matchCount: matches.length,
        truncated: matches.length >= limit,
      };
      return okList(
        structured,
        matches,
        {
          fileCount: filesSeen.size,
          matchCount: matches.length,
          truncated: matches.length >= limit,
        },
        fmt,
      );
    },
  );

  // ── glob ────────────────────────────────────────────────────────────
  server.registerTool(
    "glob",
    {
      title: "Glob file search",
      description:
        "Find files matching a glob pattern. Returns a compact list of paths.",
      inputSchema: {
        pattern: z.string().describe("Glob pattern (e.g. 'src/**/*.ts')"),
        cwd: z.string().optional().describe("Working directory for the glob"),
        format: z
          .enum(["json", "tsv", "columnar"])
          .optional()
          .describe("Output format (default: tsv)"),
      },
      outputSchema: {
        files: z.array(z.string()),
        count: z.number(),
      },
    },
    async ({ pattern, cwd, format }) => {
      const fmt = (format ?? "tsv") as ListFormat;
      const args = ["--files", "-g", pattern];

      const result = await exec("rg", args, cwd ? { cwd } : {});
      const files = result.stdout.trim().split("\n").filter(Boolean);
      const structured = { files, count: files.length };
      const fileRows = files.map((f) => ({ file: f }));
      return okList(structured, fileRows, { count: files.length }, fmt);
    },
  );
}
