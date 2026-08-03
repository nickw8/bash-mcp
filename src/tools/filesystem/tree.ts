import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import type { ListFormat } from "#format";
import { okList } from "#response";
import { defineTool } from "#tool";

/** Node from tree's JSON output (-J flag). */
interface TreeNode {
  type: string;
  name: string;
  contents?: TreeNode[];
}

type TreeEntry = { path: string; type: "file" | "dir"; depth: number };

/**
 * One path per node, dirs marked with a trailing "/". Type and depth are
 * readable off the string itself, so the payload carries paths only — the
 * `{path,type,depth}` object tripled the cost of the same information
 * (ADR-0009). Used for both `structuredContent` and the text rows.
 */
function treePaths(flat: TreeEntry[]): string[] {
  return flat.map((n) => (n.type === "dir" ? `${n.path}/` : n.path));
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
  fmt: ListFormat,
) {
  const args = [path, "-maxdepth", String(maxDepth)];
  if (dirsOnly) args.push("-type", "d");
  args.push("-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*");

  const result = await exec("find", args);
  const lines = result.stdout.trim().split("\n").filter(Boolean);

  // `find` does not say which entries are directories, and neither BSD nor GNU
  // agree on a portable -printf. A second -type d pass is the cheap way to keep
  // the trailing-"/" contract the tree binary path guarantees.
  let dirPaths: Set<string>;
  if (dirsOnly) {
    dirPaths = new Set(lines);
  } else {
    const dirResult = await exec("find", [...args, "-type", "d"]);
    dirPaths = new Set(dirResult.stdout.trim().split("\n").filter(Boolean));
  }

  const tree: TreeEntry[] = lines.map((p) => ({
    path: p,
    type: dirPaths.has(p) ? ("dir" as const) : ("file" as const),
    depth: p.replace(path, "").split("/").filter(Boolean).length,
  }));

  const dirs = tree.filter((n) => n.type === "dir").length;
  const meta = { dirs, files: tree.length - dirs };
  const paths = treePaths(tree);
  return okList(
    { ...meta, paths },
    paths.map((path) => ({ path })),
    meta,
    fmt,
  );
}

/** Register the tree tool for structured directory tree output. */
export function registerTreeTool(server: McpServer) {
  defineTool(
    server,
    "tree",
    {
      title: "Directory tree",
      description:
        "Show directory structure as a compact tree. Returns structured nodes instead of ASCII art. " +
        "Use dirsOnly for directory-only view, pattern to filter by glob, maxDepth to control depth.",
      equivalentCommands: ["tree <path>"],
      inputSchema: {
        path: z.string().describe("Root directory"),
        maxDepth: z
          .number()
          .optional()
          .default(3)
          .describe("Max depth (default 3)"),
        dirsOnly: z.boolean().optional().describe("Only show directories"),
        pattern: z
          .string()
          .optional()
          .describe("Only show files matching glob pattern"),
        exclude: z
          .string()
          .optional()
          .describe(
            "Pipe-separated patterns to exclude (default: node_modules|.git|dist|__pycache__|.venv|.next|.terraform)",
          ),
        format: z
          .enum(["json", "tsv", "columnar", "bare"])
          .optional()
          .describe("Output format (default: bare — paths, dirs end with /)"),
      },
      outputSchema: {
        dirs: z.number(),
        files: z.number(),
        // Paths only, directories marked with a trailing "/" — depth is the
        // number of separators, type is the trailing slash.
        paths: z.array(z.string()),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ path, maxDepth, dirsOnly, pattern, exclude, format }) => {
      const fmt = (format ?? "bare") as ListFormat;
      const defaultExcludes =
        "node_modules|.git|dist|__pycache__|.venv|.next|.terraform";
      const args = [
        "-J",
        `--dirsfirst`,
        `-L`,
        String(maxDepth ?? 3),
        "-I",
        exclude ?? defaultExcludes,
      ];
      if (dirsOnly) args.push("-d");
      if (pattern) args.push("-P", pattern);
      args.push(path);

      const result = await exec("tree", args);

      if (result.exitCode !== 0) {
        return await treeFallback(path, maxDepth ?? 3, dirsOnly ?? false, fmt);
      }

      try {
        const json = JSON.parse(result.stdout);
        const flat: TreeEntry[] = [];
        flattenTree(json, flat, 0);

        const dirs = flat.filter((n) => n.type === "dir").length;
        const files = flat.filter((n) => n.type === "file").length;
        const meta = { dirs, files };
        const paths = treePaths(flat);
        return okList(
          { ...meta, paths },
          paths.map((path) => ({ path })),
          meta,
          fmt,
        );
      } catch {
        return await treeFallback(path, maxDepth ?? 3, dirsOnly ?? false, fmt);
      }
    },
  );
}
