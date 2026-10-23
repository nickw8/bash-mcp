import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { lsTimeArgs } from "#platform";
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
        "List files in a directory. Returns entries as [name, size, permissions, modified] — directories end with '/' and links with '@'. " +
        "Use nameOnly for names alone, recursive for one level of subdirectories, all to include hidden files.",
      equivalentCommands: ["ls -la <path>"],
      required: ["path"],
      inputSchema: {
        path: z.string().optional().describe("Directory path to list"),
        all: z.boolean().optional().describe("Include hidden files"),
        recursive: z
          .boolean()
          .optional()
          .describe("Recurse into subdirectories (1 level)"),
        nameOnly: z.boolean().optional().describe("Entries are [name] alone"),
      },
      outputSchema: {
        // [name, size, permissions, modified] rows, [name] under nameOnly:
        // an object paid all four keys on every entry (ADR-0009). Directories
        // carry a trailing "/" and links a trailing "@", so the type needs no
        // column of its own.
        entries: z.array(
          z.union([
            z.tuple([z.string(), z.number(), z.string(), z.string()]),
            z.tuple([z.string()]),
          ]),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    // Empty fallback for a `required` argument — see the note in batch.ts.
    async ({ path = "", all, recursive, nameOnly }) => {
      const fmt = "tsv";
      // One column layout on both platforms (see #platform): `perms links
      // owner group size YYYY-MM-DD HH:MM name`.
      const args = ["-lh", ...lsTimeArgs];
      if (all) args.push("-A");
      if (recursive) args.push("-R");
      args.push(path);

      const result = await exec("ls", args, { cwd: path });

      if (result.exitCode !== 0) {
        return err(result.stderr, { path });
      }

      const entries = result.stdout
        .split("\n")
        .filter((line) => line.length > 0 && !line.startsWith("total"))
        .map((line) => {
          // 7 fixed columns, then the name — which may itself contain spaces,
          // so it is everything after the time column, not a single field.
          const parts = line.split(/\s+/);
          const permissions = parts[0] ?? "";
          const size = parseSize(parts[4] ?? "0");
          const modified = parts[5] ?? "";
          const name = parts.slice(7).join(" ");
          // Mark the type in the name itself (ls -F convention) instead of
          // spending a `type` key on every entry.
          const suffix = permissions.startsWith("d")
            ? "/"
            : permissions.startsWith("l")
              ? "@"
              : "";
          const marked = name ? `${name}${suffix}` : name;
          if (nameOnly) return { name: marked };
          return { name: marked, size, permissions, modified };
        })
        .filter((e) => e.name.length > 0);

      const structured = {
        entries: entries.map((e) =>
          "size" in e ? [e.name, e.size, e.permissions, e.modified] : [e.name],
        ),
      };
      return okList(structured, entries, { total: entries.length, path }, fmt);
    },
  );
}
