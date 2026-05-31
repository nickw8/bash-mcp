import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, IS_MACOS } from "#exec";
import type { ListFormat } from "#format";
import { err, okList } from "#response";
import { defineTool } from "#tool";

/** Parse a human-readable size string (e.g. "4.2K", "10M") into bytes. */
function parseSize(s: string): number {
  const match = s.match(/^([\d.]+)([KMGTP]?)$/i);
  if (!match) return 0;
  const num = parseFloat(match[1] ?? "0");
  const unit = (match[2] ?? "").toUpperCase();
  const multipliers: Record<string, number> = {
    "": 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
  };
  return Math.round(num * (multipliers[unit] ?? 1));
}

/** Register the ls tool for structured directory listings. */
export function registerLsTool(server: McpServer) {
  defineTool(
    server,
    "ls",
    {
      title: "List directory",
      description:
        "List files in a directory. Returns structured entries with name, type, size, and permissions. Much more compact than raw ls output. " +
        "Use recursive for one level of subdirectories. Use all to include hidden files.",
      inputSchema: {
        path: z.string().describe("Directory path to list"),
        all: z.boolean().optional().describe("Include hidden files"),
        recursive: z
          .boolean()
          .optional()
          .describe("Recurse into subdirectories (1 level)"),
        nameOnly: z
          .boolean()
          .optional()
          .describe(
            "Only return names and types (omit size, permissions, modified)",
          ),
        format: z
          .enum(["json", "tsv", "columnar"])
          .optional()
          .describe("Output format (default: tsv)"),
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
      annotations: { readOnlyHint: true },
    },
    async ({ path, all, recursive, nameOnly, format }) => {
      const fmt = (format ?? "tsv") as ListFormat;
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
          const entryType =
            type === "dir" || type === "link" || type === "file"
              ? type
              : "other";
          if (nameOnly) {
            return {
              name,
              type: entryType,
              size: 0,
              permissions: "",
              modified: "",
            };
          }
          return { name, type: entryType, size, permissions, modified };
        })
        .filter((e) => e.name.length > 0);

      const structured = { entries, total: entries.length, path };
      return okList(structured, entries, { total: entries.length, path }, fmt);
    },
  );
}
