import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, IS_MACOS } from "#exec";
import type { ListFormat } from "#format";
import { err, okList } from "#response";
import { defineTool } from "#tool";

/** Parse a timespan string (e.g. "7d", "1h", "30m") into minutes for find -mmin. */
function parseTimespan(s: string): number {
  const match = s.match(/^(\d+)([mhdw])$/);
  if (!match) return 0;
  const num = parseInt(match[1] ?? "0", 10);
  const unit = match[2] ?? "";
  const multipliers: Record<string, number> = {
    m: 1,
    h: 60,
    d: 1440,
    w: 10080,
  };
  return num * (multipliers[unit] ?? 1);
}

/** Register the find_files tool for structured file search results. */
export function registerFindTool(server: McpServer) {
  defineTool(
    server,
    "find_files",
    {
      title: "Find files",
      description:
        "Find files by name pattern, type, or modification time. Returns structured list of paths. " +
        "Use names for multiple glob patterns (OR logic), modifiedWithin for recent files (e.g. '7d', '1h').",
      inputSchema: {
        path: z.string().describe("Root directory to search"),
        name: z
          .string()
          .optional()
          .describe("Filename glob pattern (e.g. '*.ts')"),
        names: z
          .array(z.string())
          .optional()
          .describe(
            "Multiple filename glob patterns (e.g. ['*.ts', '*.py', '*.sh']). Combined with OR logic.",
          ),
        type: z
          .enum(["file", "dir", "link"])
          .optional()
          .describe("Filter by type"),
        maxDepth: z.number().optional().describe("Max search depth"),
        modifiedWithin: z
          .string()
          .optional()
          .describe("Modified within timespan (e.g. '7d', '1h')"),
        withMetadata: z
          .boolean()
          .optional()
          .describe(
            "Include size (bytes) and mtime (unix timestamp) for each file",
          ),
        format: z
          .enum(["json", "tsv", "columnar"])
          .optional()
          .describe("Output format (default: tsv)"),
      },
      outputSchema: {
        files: z.array(z.string()),
        count: z.number(),
        metadata: z
          .array(
            z.object({
              file: z.string(),
              size: z.number(),
              mtime: z.number(),
            }),
          )
          .optional(),
      },
    },
    async ({
      path,
      name,
      names,
      type,
      maxDepth,
      modifiedWithin,
      withMetadata,
      format,
    }) => {
      const fmt = (format ?? "tsv") as ListFormat;
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
        args.push("-name", allNames[0] ?? "");
      } else if (allNames.length > 1) {
        args.push("(");
        allNames.forEach((n, i) => {
          if (i > 0) args.push("-o");
          args.push("-name", n);
        });
        args.push(")");
      }
      if (modifiedWithin) {
        const minutes = parseTimespan(modifiedWithin);
        if (minutes > 0) args.push("-mmin", `-${minutes}`);
      }
      args.push(
        "-not",
        "-path",
        "*/node_modules/*",
        "-not",
        "-path",
        "*/.git/*",
      );

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
            const mtime = parseInt(
              line.substring(firstSpace + 1, secondSpace),
              10,
            );
            const file = line.substring(secondSpace + 1);
            return { file, size, mtime };
          });

        const structured = { files, count: files.length, metadata };
        return okList(structured, metadata, { count: files.length }, fmt);
      }

      const structured = { files, count: files.length };
      const fileRows = files.map((f) => ({ file: f }));
      return okList(structured, fileRows, { count: files.length }, fmt);
    },
  );
}
