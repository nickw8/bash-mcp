import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { ok } from "#response";

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
async function treeFallback(path: string, maxDepth: number, dirsOnly: boolean) {
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

/** Register the tree tool for structured directory tree output. */
export function registerTreeTool(server: McpServer) {
  server.registerTool(
    "tree",
    {
      title: "Directory tree",
      description:
        "Show directory structure as a compact tree. Returns structured nodes instead of ASCII art.",
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
      },
      outputSchema: {
        dirs: z.number(),
        files: z.number(),
        tree: z.array(
          z.object({
            path: z.string(),
            type: z.enum(["file", "dir"]),
            depth: z.number(),
          }),
        ),
      },
    },
    async ({ path, maxDepth, dirsOnly, pattern, exclude }) => {
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
        return await treeFallback(path, maxDepth ?? 3, dirsOnly ?? false);
      }

      try {
        const json = JSON.parse(result.stdout);
        const flat: { path: string; type: "file" | "dir"; depth: number }[] =
          [];
        flattenTree(json, flat, 0);

        const dirs = flat.filter((n) => n.type === "dir").length;
        const files = flat.filter((n) => n.type === "file").length;
        return ok({ dirs, files, tree: flat });
      } catch {
        return await treeFallback(path, maxDepth ?? 3, dirsOnly ?? false);
      }
    },
  );
}
