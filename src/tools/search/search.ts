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
import { defineTool } from "#tool";
import { parseRgJson } from "./parse.js";

/** Register all search tools on the MCP server. */
export function registerSearchTools(server: McpServer) {
  // ── rg (ripgrep) ────────────────────────────────────────────────────
  defineTool(
    server,
    "rg",
    {
      title: "Ripgrep search",
      description:
        "Search file contents with ripgrep. Returns structured matches with file, line number, and matched text. Far more compact than raw rg output. " +
        "Use glob (string or array, '!' to exclude) to filter files, ignoreCase for case-insensitive search, " +
        "filesOnly for just filenames, countPerFile for match counts per file, maxPerFile to cap hits per file. " +
        "For 'collect all X' tasks use only:true to return just the matched substrings (one row per hit) — add replace ($1 capture groups) to extract structured values.",
      equivalentCommands: ["rg <pattern>", "grep -rn <pattern>"],
      inputSchema: {
        pattern: z.string().describe("Regex pattern to search for"),
        path: z
          .string()
          .optional()
          .describe("Directory or file to search (default: cwd)"),
        glob: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            "File glob filter(s); a string or array. Prefix with '!' to exclude (e.g. ['*.ts','!*.test.ts'])",
          ),
        ignoreCase: z.boolean().optional().describe("Case-insensitive search"),
        maxResults: z
          .number()
          .optional()
          .default(100)
          .describe("Max results to return across all files (default 100)"),
        maxPerFile: z
          .number()
          .optional()
          .describe(
            "Cap matches per file (rg --max-count), independent of maxResults — keeps one hot file from dominating",
          ),
        only: z
          .boolean()
          .optional()
          .describe(
            "Return only the matched substring(s), not the whole line — one row per match. Best for collecting tokens (versions, names, URLs)",
          ),
        replace: z
          .string()
          .optional()
          .describe(
            "Rewrite each match with this template ($1, $2 capture groups) and return the result; implies only-match extraction",
          ),
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
        maxLineLength: z
          .number()
          .optional()
          .default(300)
          .describe(
            "Window matched line text to ~this many chars centered on the match, so long/minified lines don't dump in full (0 = unlimited, default 300)",
          ),
        format: z
          .enum(["json", "tsv", "columnar", "bare", "grouped"])
          .optional()
          .describe(
            "Output format: grouped (default for matches, file header once then line+text, ripgrep-style), tsv, json, columnar (keys once), bare (no header). filesOnly defaults to bare, countPerFile to tsv.",
          ),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            "Limit the text view to these columns (e.g. ['file','line']); structuredContent keeps all",
          ),
      },
      outputSchema: {
        matches: z.array(
          z.object({
            file: z.string(),
            line: z.number(),
            text: z.string(),
            kind: z.enum(["match", "context"]).optional(),
          }),
        ),
        fileCount: z.number(),
        matchCount: z.number(),
        truncated: z.boolean(),
        fileCounts: z
          .array(z.object({ file: z.string(), count: z.number() }))
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      pattern,
      path,
      glob,
      ignoreCase,
      maxResults,
      maxPerFile,
      only,
      replace,
      context,
      filesOnly,
      countPerFile,
      fixedStrings,
      maxLineLength,
      format,
      fields,
    }) => {
      const limit = maxResults ?? 100;
      const globs = glob ? (Array.isArray(glob) ? glob : [glob]) : [];
      const pushGlobs = (args: string[]) => {
        for (const g of globs) args.push("-g", g);
      };

      if (countPerFile) {
        const fmt = (format ?? "tsv") as ListFormat;
        const args = ["--count-matches", "--no-heading"];
        if (ignoreCase) args.push("-i");
        pushGlobs(args);
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
          { fields },
        );
      }

      if (filesOnly) {
        const fmt = (format ?? "bare") as ListFormat;
        const args = ["--files-with-matches", "--no-heading"];
        if (ignoreCase) args.push("-i");
        pushGlobs(args);
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
          { fields },
        );
      }

      const fmt = (format ?? "grouped") as ListFormat;
      const maxLen = maxLineLength ?? 0;
      // Extract mode: emit matched substrings (or capture-group rewrites)
      // instead of whole lines. `replace` implies extraction.
      const extract = only === true || replace !== undefined;
      const perFileCap = maxPerFile ?? Math.min(limit, 500);

      const args = ["--json", `--max-count=${perFileCap}`];
      if (ignoreCase) args.push("-i");
      pushGlobs(args);
      if (context && !extract) args.push("-C", String(context));
      if (fixedStrings) args.push("-F");
      if (replace !== undefined) args.push("-r", replace);
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

      // Collect matches and (when requested) context lines, in rg's emit order.
      const { entries, matchCount, fileCount } = parseRgJson(result.stdout, {
        limit,
        extract,
        replace,
        context,
        maxLen,
      });

      const truncated = matchCount >= limit;
      const withContext = Boolean(context) && !extract;

      // structuredContent keeps numeric lines; carry `kind` only when context
      // was requested (otherwise every entry is a match — keep the lean shape).
      const matches = entries.map((e) =>
        withContext
          ? { file: e.file, line: e.line, text: e.text, kind: e.kind }
          : { file: e.file, line: e.line, text: e.text },
      );

      // Text rows mark context lines with a trailing `-` on the line number
      // (ripgrep's grep convention), so grouped/tsv output distinguishes them.
      const textRows = entries.map((e) => ({
        file: e.file,
        line: e.kind === "context" ? `${e.line}-` : e.line,
        text: e.text,
      }));

      const structured = {
        matches,
        fileCount,
        matchCount,
        truncated,
      };
      return okList(
        structured,
        textRows,
        { fileCount, matchCount, truncated },
        fmt,
        { fields },
      );
    },
  );

  // ── glob ────────────────────────────────────────────────────────────
  defineTool(
    server,
    "glob",
    {
      title: "Glob file search",
      description:
        "Find files matching a glob pattern. Returns a compact list of paths.",
      equivalentCommands: ["find <path> -name <glob>"],
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
      annotations: { readOnlyHint: true },
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
