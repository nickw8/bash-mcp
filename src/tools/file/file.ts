/**
 * File Tools
 *
 * - cat:     Read file contents with smart truncation and metadata.
 * - outline: Structural overview of a file (functions, classes, imports)
 *            without implementation bodies. For reviewing file structure
 *            at a fraction of the token cost of reading full content.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { err, ok } from "#response";
import { detectLanguage, extractOutline } from "./outline/index.js";

const IS_MACOS = process.platform === "darwin";

/** Register all file tools on the MCP server. */
export function registerFileTools(server: McpServer) {
  server.registerTool(
    "cat",
    {
      title: "Read file contents",
      description:
        "Read file contents with line numbers and smart truncation. Returns structured output with metadata. For large files, use startLine/endLine or maxLines to limit output.",
      inputSchema: {
        path: z.string().describe("Path to the file"),
        startLine: z
          .number()
          .optional()
          .describe("Start reading from this line (1-based)"),
        endLine: z
          .number()
          .optional()
          .describe("Stop reading at this line (inclusive)"),
        maxLines: z
          .number()
          .optional()
          .default(200)
          .describe("Max lines to return (default 200, use 0 for unlimited)"),
        lineNumbers: z
          .boolean()
          .optional()
          .describe(
            "Prepend line numbers to each line (useful before editing)",
          ),
      },
      outputSchema: {
        path: z.string(),
        totalLines: z.number(),
        size: z.number(),
        mtime: z.number().describe("File modification time (unix timestamp)"),
        content: z.string(),
        range: z.tuple([z.number(), z.number()]),
        truncated: z.boolean(),
      },
    },
    async ({ path, startLine, endLine, maxLines, lineNumbers }) => {
      const empty: {
        path: string;
        totalLines: number;
        size: number;
        mtime: number;
        content: string;
        range: [number, number];
        truncated: boolean;
      } = {
        path,
        totalLines: 0,
        size: 0,
        mtime: 0,
        content: "",
        range: [0, 0],
        truncated: false,
      };

      // Get file size and mtime in one stat call
      const statResult = await exec(
        "stat",
        IS_MACOS ? ["-f", "%z %m", path] : ["--format=%s %Y", path],
      );
      if (statResult.exitCode !== 0) {
        return err(statResult.stderr || `Cannot stat file: ${path}`, empty);
      }
      const [sizeStr, mtimeStr] = statResult.stdout.trim().split(" ");
      const size = parseInt(sizeStr ?? "0", 10);
      const mtime = parseInt(mtimeStr ?? "0", 10);

      // Get total line count
      const wcResult = await exec("wc", ["-l", path]);
      if (wcResult.exitCode !== 0) {
        return err(wcResult.stderr || `Cannot read file: ${path}`, empty);
      }
      const totalLines = parseInt(
        wcResult.stdout.trim().split(/\s+/)[0] ?? "0",
        10,
      );

      // Determine the range and read content
      let content: string;
      let rangeStart: number;
      let rangeEnd: number;
      let truncated: boolean;

      if (startLine !== undefined || endLine !== undefined) {
        // Explicit range requested
        rangeStart = Math.max(1, startLine ?? 1);
        rangeEnd =
          endLine !== undefined ? Math.min(endLine, totalLines) : totalLines;

        // Apply maxLines cap within the range
        if (
          maxLines !== undefined &&
          maxLines > 0 &&
          rangeEnd - rangeStart + 1 > maxLines
        ) {
          rangeEnd = rangeStart + maxLines - 1;
          truncated = true;
        } else {
          truncated = rangeEnd < totalLines && endLine === undefined;
        }

        const sedResult = await exec("sed", [
          "-n",
          `${rangeStart},${rangeEnd}p`,
          path,
        ]);
        if (sedResult.exitCode !== 0) {
          return err(sedResult.stderr || `Cannot read file: ${path}`, empty);
        }
        content = sedResult.stdout;
      } else if (maxLines === 0) {
        // Unlimited — read the whole file
        const catResult = await exec("cat", [path]);
        if (catResult.exitCode !== 0) {
          return err(catResult.stderr || `Cannot read file: ${path}`, empty);
        }
        content = catResult.stdout;
        rangeStart = 1;
        rangeEnd = totalLines;
        truncated = false;
      } else {
        // Default: head with maxLines
        const limit = maxLines ?? 200;
        const headResult = await exec("head", ["-n", String(limit), path]);
        if (headResult.exitCode !== 0) {
          return err(headResult.stderr || `Cannot read file: ${path}`, empty);
        }
        content = headResult.stdout;
        rangeStart = 1;
        rangeEnd = Math.min(limit, totalLines);
        truncated = totalLines > limit;
      }

      // Strip trailing newline to avoid an empty last "line"
      if (content.endsWith("\n")) {
        content = content.slice(0, -1);
      }

      // Add line numbers if requested
      if (lineNumbers) {
        const lines = content.split("\n");
        const startNum = rangeStart;
        content = lines
          .map((line, i) => `${String(startNum + i).padStart(6)}\t${line}`)
          .join("\n");
      }

      return ok({
        path,
        totalLines,
        size,
        mtime,
        content,
        range: [rangeStart, rangeEnd] satisfies [number, number],
        truncated,
      });
    },
  );

  server.registerTool(
    "outline",
    {
      title: "File structure outline",
      description:
        "Show the structural outline of a file — function/class names, top-level comments, imports. " +
        "Returns a compact view without implementation bodies. " +
        "Use instead of cat when reviewing file structure or auditing many files at once.",
      inputSchema: {
        path: z.string().describe("Path to the file"),
      },
      outputSchema: {
        path: z.string(),
        language: z.string(),
        totalLines: z.number(),
        outlineLines: z.number(),
        symbols: z.number(),
        outline: z.string(),
      },
    },
    async ({ path }) => {
      const empty = {
        path,
        language: "unknown",
        totalLines: 0,
        outlineLines: 0,
        symbols: 0,
        outline: "",
      };

      const catResult = await exec("cat", [path]);
      if (catResult.exitCode !== 0) {
        return err(catResult.stderr || `Cannot read file: ${path}`, empty);
      }

      const content = catResult.stdout;
      const totalLines = content.split("\n").length;
      const language = detectLanguage(path);
      const { outline, symbols } = extractOutline(content, language);
      const outlineLines = outline ? outline.split("\n").length : 0;

      return ok({ path, language, totalLines, outlineLines, symbols, outline });
    },
  );
}
