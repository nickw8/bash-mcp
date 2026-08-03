/**
 * Search Tools
 *
 * Wraps ripgrep (rg) for content search and glob-based file matching.
 * Uses rg's JSON output mode to return structured match data instead
 * of line-oriented text.
 */

import { isAbsolute, relative } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import type { ListFormat } from "#format";
import { err, okList } from "#response";
import { defineTool } from "#tool";
import { groupMatchesByFile, parseRgJson } from "./parse.js";

/** Shorten an absolute path to cwd-relative — the payload repeats it per file. */
const relPath = (file: string) =>
  isAbsolute(file) ? relative(process.cwd(), file) || file : file;

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
          .default(30)
          .describe(
            "Max results to return across all files (default 30). When the cap bites, the response reports the true totalMatches so you can decide whether to narrow the pattern or raise the cap",
          ),
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
          .default(120)
          .describe(
            "Window matched line text to ~this many chars centered on the match, so long/minified lines don't dump in full (0 = unlimited, default 120)",
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
            "Limit the text view to these columns (e.g. ['file','line']); text view only",
          ),
      },
      outputSchema: {
        // Grouped by file: the path is paid for once, and each hit is one
        // "<line>:<text>" string ("<line>-<text>" for a context line) rather
        // than an object repeating the same two keys (ADR-0009).
        files: z.array(
          z.object({
            file: z.string(),
            lines: z.array(z.string()).optional(),
            count: z.number().optional(),
          }),
        ),
        fileCount: z.number(),
        matchCount: z.number(),
        truncated: z.boolean(),
        totalMatches: z.number().optional(),
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
      const limit = maxResults ?? 30;
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
          return err(result.stderr);
        }

        const files: { file: string; count: number }[] = [];
        let totalMatches = 0;

        for (const line of result.stdout.trim().split("\n").filter(Boolean)) {
          const lastColon = line.lastIndexOf(":");
          if (lastColon === -1) continue;
          const file = relPath(line.slice(0, lastColon));
          const count = parseInt(line.slice(lastColon + 1), 10);
          if (Number.isNaN(count)) continue;
          files.push({ file, count });
          totalMatches += count;
        }

        const structured = {
          files,
          fileCount: files.length,
          matchCount: totalMatches,
          truncated: false,
        };
        return okList(
          structured,
          files,
          { fileCount: files.length, matchCount: totalMatches },
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

        // Same rule as the other rg paths: 1 is "no matches", >= 2 is a real
        // failure (bad regex, unreadable path). Without this a broken pattern
        // reported an empty result set instead of the error rg printed.
        if (result.exitCode !== 0 && result.exitCode !== 1) {
          return err(result.stderr);
        }

        const files = result.stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((f) => ({ file: relPath(f) }));
        const structured = {
          files,
          fileCount: files.length,
          matchCount: files.length,
          truncated: false,
        };
        return okList(
          structured,
          files,
          { fileCount: files.length, matchCount: files.length },
          fmt,
          { fields },
        );
      }

      const fmt = (format ?? "grouped") as ListFormat;
      const maxLen = maxLineLength ?? 120;
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
        return err(result.stderr);
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

      // The cap hides how much was left behind, so pay one extra `rg
      // --count-matches` pass (counts only, no line text) for the true total.
      let totalMatches: number | undefined;
      if (truncated) {
        const countArgs = ["--count-matches", "--no-heading"];
        if (ignoreCase) countArgs.push("-i");
        pushGlobs(countArgs);
        if (fixedStrings) countArgs.push("-F");
        countArgs.push(pattern);
        if (path) countArgs.push(path);
        const counted = await exec("rg", countArgs);
        if (counted.exitCode === 0) {
          totalMatches = counted.stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .reduce((sum, line) => {
              const n = parseInt(line.slice(line.lastIndexOf(":") + 1), 10);
              return Number.isNaN(n) ? sum : sum + n;
            }, 0);
        }
      }

      // Text rows mark context lines with a trailing `-` on the line number
      // (ripgrep's grep convention), so grouped/tsv output distinguishes them.
      const textRows = entries.map((e) => ({
        file: relPath(e.file),
        line: e.kind === "context" ? `${e.line}-` : e.line,
        text: e.text,
      }));

      const structured = {
        files: groupMatchesByFile(entries, relPath),
        fileCount,
        matchCount,
        truncated,
        ...(totalMatches !== undefined ? { totalMatches } : {}),
      };
      return okList(
        structured,
        textRows,
        { fileCount, matchCount, truncated, totalMatches },
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

      // `--files` exits 1 when nothing matched the glob; >= 2 means rg refused
      // the glob or the directory, which is an error, not an empty listing.
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        return err(result.stderr);
      }

      const files = result.stdout.trim().split("\n").filter(Boolean);
      const structured = { files, count: files.length };
      const fileRows = files.map((f) => ({ file: f }));
      return okList(structured, fileRows, { count: files.length }, fmt);
    },
  );
}
