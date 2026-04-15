/**
 * Filesystem Tools
 *
 * Wraps standard filesystem commands (ls, tree, du, find) and returns
 * structured JSON instead of human-readable text. Handles fallbacks
 * gracefully — e.g. if `tree` is not installed, falls back to `find`.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { exec } from "#exec";
import { ok, err } from "#response";

const IS_MACOS = process.platform === "darwin";

/** Register all filesystem tools on the MCP server. */
export function registerFilesystemTools(server: McpServer) {
  // ── ls ──────────────────────────────────────────────────────────────
  server.registerTool("ls", {
    title: "List directory",
    description:
      "List files in a directory. Returns structured entries with name, type, size, and permissions. Much more compact than raw ls output.",
    inputSchema: {
      path: z.string().describe("Directory path to list"),
      all: z.boolean().optional().describe("Include hidden files"),
      recursive: z.boolean().optional().describe("Recurse into subdirectories (1 level)"),
      nameOnly: z.boolean().optional().describe("Only return names and types (omit size, permissions, modified)"),
    },
    outputSchema: {
      entries: z.array(
        z.object({
          name: z.string(),
          type: z.enum(["file", "dir", "link", "other"]),
          size: z.number(),
          permissions: z.string(),
          modified: z.string(),
        }),
      ),
      total: z.number(),
      path: z.string(),
    },
  }, async ({ path, all, recursive, nameOnly }) => {
    const args = IS_MACOS ? ["-lh"] : ["-lh", "--time-style=iso"];
    if (all) args.push("-A");
    if (recursive) args.push("-R");
    args.push(path);

    const result = await exec("ls", args, { cwd: path });

    if (result.exitCode !== 0) {
      return err(result.stderr, { entries: [], total: 0, path });
    }

    const entries = result.stdout
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("total"))
      .map((line) => {
        const parts = line.split(/\s+/);
        const permissions = parts[0] ?? "";
        const size = parseSize(parts[4] ?? "0");
        const modified = parts[5] ?? "";
        const name = parts.slice(6).join(" ");
        const type = permissions.startsWith("d")
          ? "dir"
          : permissions.startsWith("l")
            ? "link"
            : permissions.startsWith("-")
              ? "file"
              : "other";
        const entryType = type === "dir" || type === "link" || type === "file" ? type : "other";
        if (nameOnly) {
          return { name, type: entryType, size: 0, permissions: "", modified: "" };
        }
        return { name, type: entryType, size, permissions, modified };
      })
      .filter((e) => e.name.length > 0);

    return ok({ entries, total: entries.length, path });
  });

  // ── tree ────────────────────────────────────────────────────────────
  server.registerTool("tree", {
    title: "Directory tree",
    description:
      "Show directory structure as a compact tree. Returns structured nodes instead of ASCII art.",
    inputSchema: {
      path: z.string().describe("Root directory"),
      maxDepth: z.number().optional().default(3).describe("Max depth (default 3)"),
      dirsOnly: z.boolean().optional().describe("Only show directories"),
      pattern: z.string().optional().describe("Only show files matching glob pattern"),
      exclude: z.string().optional().describe("Pipe-separated patterns to exclude (default: node_modules|.git|dist|__pycache__|.venv|.next|.terraform)"),
    },
    outputSchema: {
      dirs: z.number(),
      files: z.number(),
      tree: z.array(z.object({
        path: z.string(),
        type: z.enum(["file", "dir"]),
        depth: z.number(),
      })),
    },
  }, async ({ path, maxDepth, dirsOnly, pattern, exclude }) => {
    const defaultExcludes = "node_modules|.git|dist|__pycache__|.venv|.next|.terraform";
    const args = ["-J", `--dirsfirst`, `-L`, String(maxDepth ?? 3), "-I", exclude ?? defaultExcludes];
    if (dirsOnly) args.push("-d");
    if (pattern) args.push("-P", pattern);
    args.push(path);

    const result = await exec("tree", args);

    if (result.exitCode !== 0) {
      // tree might not be installed, fall back to find
      return await treeFallback(path, maxDepth ?? 3, dirsOnly ?? false);
    }

    try {
      const json = JSON.parse(result.stdout);
      const flat: { path: string; type: "file" | "dir"; depth: number }[] = [];
      flattenTree(json, flat, 0);

      const dirs = flat.filter((n) => n.type === "dir").length;
      const files = flat.filter((n) => n.type === "file").length;
      return ok({ dirs, files, tree: flat });
    } catch {
      return await treeFallback(path, maxDepth ?? 3, dirsOnly ?? false);
    }
  });

  // ── du (disk usage) ─────────────────────────────────────────────────
  server.registerTool("du", {
    title: "Disk usage",
    description:
      "Show disk usage for paths. Returns structured size data.",
    inputSchema: {
      path: z.string().describe("Path to measure"),
      maxDepth: z.number().optional().default(1).describe("Depth to summarize"),
    },
    outputSchema: {
      entries: z.array(
        z.object({
          path: z.string(),
          sizeBytes: z.number(),
          sizeHuman: z.string(),
        }),
      ),
    },
  }, async ({ path, maxDepth }) => {
    const depth = maxDepth ?? 1;
    const duArgs = IS_MACOS
      ? ["-k", "-d", String(depth), path]
      : ["-b", `--max-depth=${depth}`, path];
    const result = await exec("du", duArgs);

    if (result.exitCode !== 0) {
      return err(result.stderr, { entries: [] });
    }

    const sizeMultiplier = IS_MACOS ? 1024 : 1;
    const entries = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sizeStr, ...pathParts] = line.split("\t");
        const sizeBytes = parseInt(sizeStr ?? "0", 10) * sizeMultiplier;
        return {
          path: pathParts.join("\t"),
          sizeBytes,
          sizeHuman: humanSize(sizeBytes),
        };
      });

    return ok({ entries });
  });

  // ── find ────────────────────────────────────────────────────────────
  server.registerTool("find_files", {
    title: "Find files",
    description:
      "Find files by name pattern, type, or modification time. Returns structured list of paths.",
    inputSchema: {
      path: z.string().describe("Root directory to search"),
      name: z.string().optional().describe("Filename glob pattern (e.g. '*.ts')"),
      names: z.array(z.string()).optional().describe("Multiple filename glob patterns (e.g. ['*.ts', '*.py', '*.sh']). Combined with OR logic."),
      type: z.enum(["file", "dir", "link"]).optional().describe("Filter by type"),
      maxDepth: z.number().optional().describe("Max search depth"),
      modifiedWithin: z.string().optional().describe("Modified within timespan (e.g. '7d', '1h')"),
      withMetadata: z.boolean().optional().describe("Include size (bytes) and mtime (unix timestamp) for each file"),
    },
    outputSchema: {
      files: z.array(z.string()),
      count: z.number(),
      metadata: z.array(z.object({
        file: z.string(),
        size: z.number(),
        mtime: z.number(),
      })).optional(),
    },
  }, async ({ path, name, names, type, maxDepth, modifiedWithin, withMetadata }) => {
    const allNames = names ?? (name ? [name] : []);
    const args = [path];
    if (maxDepth !== undefined) args.push("-maxdepth", String(maxDepth));
    if (type) {
      const typeMap = { file: "f", dir: "d", link: "l" } as const;
      args.push("-type", typeMap[type]);
    } else if (allNames.length > 0) {
      // Default to files when a name pattern is provided (directories rarely match *.ext patterns)
      args.push("-type", "f");
    }
    if (allNames.length === 1) {
      args.push("-name", allNames[0]!);
    } else if (allNames.length > 1) {
      args.push("(");
      for (let i = 0; i < allNames.length; i++) {
        if (i > 0) args.push("-o");
        args.push("-name", allNames[i]!);
      }
      args.push(")");
    }
    if (modifiedWithin) {
      const minutes = parseTimespan(modifiedWithin);
      if (minutes > 0) args.push("-mmin", `-${minutes}`);
    }
    args.push("-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*");

    const result = await exec("find", args);

    const files = result.stdout.trim().split("\n").filter(Boolean);

    if (withMetadata && files.length > 0) {
      // Run stat on all files in a single call
      const statArgs = IS_MACOS
        ? ["-f", "%z %m %N", ...files]
        : ["--format=%s %Y %n", ...files];
      const statResult = await exec("stat", statArgs);

      if (statResult.exitCode !== 0) {
        return err(statResult.stderr, { files, count: files.length });
      }

      const metadata = statResult.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const firstSpace = line.indexOf(" ");
          const secondSpace = line.indexOf(" ", firstSpace + 1);
          const size = parseInt(line.substring(0, firstSpace), 10);
          const mtime = parseInt(line.substring(firstSpace + 1, secondSpace), 10);
          const file = line.substring(secondSpace + 1);
          return { file, size, mtime };
        });

      return ok({ files, count: files.length, metadata });
    }

    return ok({ files, count: files.length });
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Parse a human-readable size string (e.g. "4.2K", "10M") into bytes. */
function parseSize(s: string): number {
  const match = s.match(/^([\d.]+)([KMGTP]?)$/i);
  if (!match) return 0;
  const num = parseFloat(match[1]!);
  const unit = (match[2] ?? "").toUpperCase();
  const multipliers: Record<string, number> = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
  return Math.round(num * (multipliers[unit] ?? 1));
}

/** Format bytes into a human-readable size string (e.g. 1024 -> "1.0KB"). */
function humanSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(i === 0 ? 0 : 1)}${units[i]}`;
}

/** Parse a timespan string (e.g. "7d", "1h", "30m") into minutes for find -mmin. */
function parseTimespan(s: string): number {
  const match = s.match(/^(\d+)([mhdw])$/);
  if (!match) return 0;
  const num = parseInt(match[1]!, 10);
  const unit = match[2]!;
  const multipliers: Record<string, number> = { m: 1, h: 60, d: 1440, w: 10080 };
  return num * (multipliers[unit] ?? 1);
}

/** Node from tree's JSON output (-J flag). */
interface TreeNode {
  type: string;
  name: string;
  contents?: TreeNode[];
}

/** Recursively flatten tree's nested JSON into a flat array with depth. */
function flattenTree(
  nodes: TreeNode[],
  result: { path: string; type: "file" | "dir"; depth: number }[],
  depth: number,
  prefix = "",
) {
  for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
    if (node.type === "report") continue;
    const fullPath = prefix ? `${prefix}/${node.name}` : node.name;
    const type = node.type === "directory" ? "dir" : "file";
    result.push({ path: fullPath, type, depth });
    if (node.contents) {
      flattenTree(node.contents, result, depth + 1, fullPath);
    }
  }
}

/** Fallback tree implementation using find when tree binary is not installed. */
async function treeFallback(
  path: string,
  maxDepth: number,
  dirsOnly: boolean,
) {
  const args = [path, "-maxdepth", String(maxDepth)];
  if (dirsOnly) args.push("-type", "d");
  args.push("-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*");

  const result = await exec("find", args);
  const lines = result.stdout.trim().split("\n").filter(Boolean);

  const tree = lines.map((p) => ({
    path: p,
    type: "file" as const,
    depth: p.replace(path, "").split("/").filter(Boolean).length,
  }));

  return ok({ dirs: 0, files: tree.length, tree });
}
