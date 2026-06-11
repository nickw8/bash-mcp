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
import { exec, IS_MACOS } from "#exec";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import { detectLanguage, extractOutline } from "./outline/index.js";

/** Find the git repo root for a file path. Returns null if not in a git repo. */
async function findGitRoot(filePath: string): Promise<string | null> {
  const dir = filePath.replace(/\/[^/]*$/, "") || ".";
  const result = await exec("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
  if (result.exitCode !== 0) return null;
  return result.stdout.trim();
}

/** Get git branch and last commit hash for a file. Returns nulls if not in a git repo. */
async function getGitMeta(
  filePath: string,
  ref?: string,
): Promise<{ branch: string | null; commit: string | null }> {
  const gitRoot = await findGitRoot(filePath);
  if (!gitRoot) return { branch: null, commit: null };

  const relPath = filePath.startsWith(gitRoot)
    ? filePath.slice(gitRoot.length + 1)
    : filePath;

  // Run branch and commit lookups in parallel
  const [branchResult, commitResult] = await Promise.all([
    exec("git", ["-C", gitRoot, "rev-parse", "--abbrev-ref", "HEAD"]),
    exec("git", [
      "-C",
      gitRoot,
      "log",
      "-1",
      "--format=%H",
      ref ?? "HEAD",
      "--",
      relPath,
    ]),
  ]);

  return {
    branch:
      branchResult.exitCode === 0 ? branchResult.stdout.trim() || null : null,
    commit:
      commitResult.exitCode === 0 ? commitResult.stdout.trim() || null : null,
  };
}

/** One file's read result. `error` is set (with empty content) on failure. */
interface CatResult {
  path: string;
  totalLines: number;
  size: number;
  mtime: number;
  content: string;
  range: [number, number];
  truncated: boolean;
  error?: string;
}

interface CatParams {
  ref?: string;
  startLine?: number;
  endLine?: number;
  maxLines?: number;
  lineNumbers?: boolean;
}

/**
 * Read a single file (from disk, or from a git ref) with line-range/maxLines
 * truncation and optional line numbers. Returns a CatResult; on failure the
 * `error` field is set rather than throwing, so batch reads can report
 * per-file failures without aborting the whole call.
 */
async function readFileContent(
  path: string,
  { ref, startLine, endLine, maxLines, lineNumbers }: CatParams,
): Promise<CatResult> {
  const empty: CatResult = {
    path,
    totalLines: 0,
    size: 0,
    mtime: 0,
    content: "",
    range: [0, 0],
    truncated: false,
  };

  // When ref is provided, read from git and apply line range/truncation
  if (ref) {
    const gitDir = await findGitRoot(path);
    if (!gitDir) return { ...empty, error: `Not in a git repo: ${path}` };
    const relPath = path.startsWith(gitDir)
      ? path.slice(gitDir.length + 1)
      : path;
    const showResult = await exec("git", [
      "-C",
      gitDir,
      "show",
      `${ref}:${relPath}`,
    ]);
    if (showResult.exitCode !== 0) {
      return {
        ...empty,
        error: showResult.stderr || `Cannot read ${ref}:${relPath}`,
      };
    }

    let allLines = showResult.stdout;
    if (allLines.endsWith("\n")) allLines = allLines.slice(0, -1);
    const lines = allLines.split("\n");
    const totalLines = lines.length;
    const limit = maxLines === 0 ? totalLines : (maxLines ?? 200);
    const rangeStart = Math.max(1, startLine ?? 1);
    let rangeEnd =
      endLine !== undefined
        ? Math.min(endLine, totalLines)
        : Math.min(rangeStart + limit - 1, totalLines);
    let truncated = false;
    if (limit > 0 && rangeEnd - rangeStart + 1 > limit) {
      rangeEnd = rangeStart + limit - 1;
      truncated = true;
    } else {
      truncated = rangeEnd < totalLines && endLine === undefined;
    }

    let content = lines.slice(rangeStart - 1, rangeEnd).join("\n");
    if (lineNumbers) {
      content = content
        .split("\n")
        .map((line, i) => `${String(rangeStart + i).padStart(6)}\t${line}`)
        .join("\n");
    }

    return {
      path,
      totalLines,
      size: showResult.stdout.length,
      mtime: 0,
      content,
      range: [rangeStart, rangeEnd],
      truncated,
    };
  }

  // Get file size and mtime in one stat call
  const statResult = await exec(
    "stat",
    IS_MACOS ? ["-f", "%z %m", path] : ["--format=%s %Y", path],
  );
  if (statResult.exitCode !== 0) {
    return {
      ...empty,
      error: statResult.stderr || `Cannot stat file: ${path}`,
    };
  }
  const [sizeStr, mtimeStr] = statResult.stdout.trim().split(" ");
  const size = parseInt(sizeStr ?? "0", 10);
  const mtime = parseInt(mtimeStr ?? "0", 10);

  // Get total line count
  const wcResult = await exec("wc", ["-l", path]);
  if (wcResult.exitCode !== 0) {
    return { ...empty, error: wcResult.stderr || `Cannot read file: ${path}` };
  }
  const totalLines = parseInt(
    wcResult.stdout.trim().split(/\s+/)[0] ?? "0",
    10,
  );

  let content: string;
  let rangeStart: number;
  let rangeEnd: number;
  let truncated: boolean;

  if (startLine !== undefined || endLine !== undefined) {
    // Explicit range requested
    rangeStart = Math.max(1, startLine ?? 1);
    rangeEnd =
      endLine !== undefined ? Math.min(endLine, totalLines) : totalLines;

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
      return {
        ...empty,
        error: sedResult.stderr || `Cannot read file: ${path}`,
      };
    }
    content = sedResult.stdout;
  } else if (maxLines === 0) {
    // Unlimited — read the whole file
    const catResult = await exec("cat", [path]);
    if (catResult.exitCode !== 0) {
      return {
        ...empty,
        error: catResult.stderr || `Cannot read file: ${path}`,
      };
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
      return {
        ...empty,
        error: headResult.stderr || `Cannot read file: ${path}`,
      };
    }
    content = headResult.stdout;
    rangeStart = 1;
    rangeEnd = Math.min(limit, totalLines);
    truncated = totalLines > limit;
  }

  // Strip trailing newline to avoid an empty last "line"
  if (content.endsWith("\n")) content = content.slice(0, -1);

  if (lineNumbers) {
    const lines = content.split("\n");
    content = lines
      .map((line, i) => `${String(rangeStart + i).padStart(6)}\t${line}`)
      .join("\n");
  }

  return {
    path,
    totalLines,
    size,
    mtime,
    content,
    range: [rangeStart, rangeEnd],
    truncated,
  };
}

/** Register all file tools on the MCP server. */
export function registerFileTools(server: McpServer) {
  defineTool(
    server,
    "cat",
    {
      title: "Read file contents",
      description:
        "Read one or more files with line numbers and smart truncation. Returns structured output with metadata. " +
        "Pass `path` for a single file, or `paths` to read several in one call (returns { files, count }) — " +
        "collapsing what would otherwise be multiple round-trips. " +
        "For large files, use startLine/endLine or maxLines to limit output. " +
        "Use ref to read from a git branch/commit instead of disk (e.g. ref='main'). " +
        'NOTE: reading with cat does NOT satisfy the built-in Edit/Write "must read first" guard ' +
        "(it tracks only the built-in Read tool) — run the built-in Read on a file immediately before editing it.",
      inputSchema: {
        path: z.string().optional().describe("Path to a single file"),
        paths: z
          .array(z.string())
          .optional()
          .describe(
            "Read multiple files in one call. Returns { files, count }; a per-file failure is reported in that file's `error` and does not abort the others.",
          ),
        ref: z
          .string()
          .optional()
          .describe(
            "Git ref to read from (e.g. 'main', 'HEAD~1', a commit hash). " +
              "When set, reads file content from git (git show ref:path) instead of disk.",
          ),
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
          .describe(
            "Max lines to return per file (default 200, use 0 for unlimited)",
          ),
        lineNumbers: z
          .boolean()
          .optional()
          .describe(
            "Prepend line numbers to each line (useful when locating a line). " +
              "Does not register the file as read for the built-in Edit — use the built-in Read right before editing.",
          ),
      },
      outputSchema: {
        // single-file mode (path): fields appear at the top level
        path: z.string().optional(),
        totalLines: z.number().optional(),
        size: z.number().optional(),
        mtime: z
          .number()
          .optional()
          .describe("File modification time (unix timestamp)"),
        content: z.string().optional(),
        range: z.tuple([z.number(), z.number()]).optional(),
        truncated: z.boolean().optional(),
        error: z.string().optional(),
        // multi-file mode (paths): results collected under `files`
        files: z
          .array(
            z.object({
              path: z.string(),
              totalLines: z.number(),
              size: z.number(),
              mtime: z.number(),
              content: z.string(),
              range: z.tuple([z.number(), z.number()]),
              truncated: z.boolean(),
              error: z.string().optional(),
            }),
          )
          .optional(),
        count: z.number().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ path, paths, ref, startLine, endLine, maxLines, lineNumbers }) => {
      const params: CatParams = {
        ref,
        startLine,
        endLine,
        maxLines,
        lineNumbers,
      };
      const emptySingle = {
        path: path ?? "",
        totalLines: 0,
        size: 0,
        mtime: 0,
        content: "",
        range: [0, 0] as [number, number],
        truncated: false,
      };

      // Multi-file mode: read all in parallel; per-file failures surface in each
      // file's `error` field and never abort the batch.
      if (paths && paths.length > 0) {
        const files = await Promise.all(
          paths.map((p) => readFileContent(p, params)),
        );
        return ok({ files, count: files.length });
      }

      if (!path) {
        return err(
          "Provide `path` (single file) or `paths` (multiple files)",
          emptySingle,
        );
      }

      const result = await readFileContent(path, params);
      if (result.error) return err(result.error, emptySingle);
      return ok({ ...result });
    },
  );

  defineTool(
    server,
    "outline",
    {
      title: "File structure outline",
      description:
        "Show the structural outline of a file — function/class names, top-level comments, imports. " +
        "Returns a compact view without implementation bodies. " +
        "Includes git metadata (branch, commit) when the file is in a git repo. " +
        "Use instead of cat when reviewing file structure or auditing many files at once.",
      inputSchema: {
        path: z.string().describe("Path to the file"),
        ref: z
          .string()
          .optional()
          .describe(
            "Git ref to outline (e.g. 'main', 'HEAD~1', a commit hash). " +
              "When set, reads file content from git (git show ref:path) instead of disk.",
          ),
      },
      outputSchema: {
        path: z.string(),
        language: z.string(),
        totalLines: z.number(),
        outlineLines: z.number(),
        symbols: z.number(),
        mtime: z
          .number()
          .describe("File modification time (unix timestamp). 0 if using ref."),
        branch: z
          .string()
          .nullable()
          .describe("Current git branch, or null if not in a git repo"),
        commit: z
          .string()
          .nullable()
          .describe(
            "Last commit hash that touched this file, or null if not in a git repo",
          ),
        outline: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ path, ref }) => {
      const empty = {
        path,
        language: "unknown" as string,
        totalLines: 0,
        outlineLines: 0,
        symbols: 0,
        mtime: 0,
        branch: null as string | null,
        commit: null as string | null,
        outline: "",
      };

      let content: string;
      let mtime = 0;

      if (ref) {
        // Read file content from a git ref instead of disk
        const gitDir = await findGitRoot(path);
        if (!gitDir) {
          return err(`Not in a git repo: ${path}`, empty);
        }
        // Resolve path relative to git root for git show
        const relPath = path.startsWith(gitDir)
          ? path.slice(gitDir.length + 1)
          : path;
        const showResult = await exec("git", [
          "-C",
          gitDir,
          "show",
          `${ref}:${relPath}`,
        ]);
        if (showResult.exitCode !== 0) {
          return err(
            showResult.stderr || `Cannot read ${ref}:${relPath}`,
            empty,
          );
        }
        content = showResult.stdout;
      } else {
        // Read from disk
        const catResult = await exec("cat", [path]);
        if (catResult.exitCode !== 0) {
          return err(catResult.stderr || `Cannot read file: ${path}`, empty);
        }
        content = catResult.stdout;

        // Get mtime
        const statResult = await exec(
          "stat",
          IS_MACOS ? ["-f", "%m", path] : ["--format=%Y", path],
        );
        if (statResult.exitCode === 0) {
          mtime = parseInt(statResult.stdout.trim(), 10) || 0;
        }
      }

      const totalLines = content.split("\n").length;
      const language = detectLanguage(path);
      const { outline, symbols } = extractOutline(content, language);
      const outlineLines = outline ? outline.split("\n").length : 0;

      // Gather git metadata (branch + last commit for this file)
      const git = await getGitMeta(path, ref);

      return ok({
        path,
        language,
        totalLines,
        outlineLines,
        symbols,
        mtime,
        branch: git.branch,
        commit: git.commit,
        outline,
      });
    },
  );
}
