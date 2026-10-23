import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import type { ListFormat } from "#format";
import { err, okList } from "#response";
import { defineTool } from "#tool";

/** Format bytes into a human-readable size string (e.g. 1024 -> "1.0KB"). */
function humanSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)}${units[i]}`;
}

/** Register the du tool for structured disk usage output. */
export function registerDuTool(server: McpServer) {
  defineTool(
    server,
    "du",
    {
      title: "Disk usage",
      description:
        "Show disk usage for paths. Returns entries as [path, sizeBytes] pairs, in the order du emits them. " +
        "Use maxDepth to control how deep the summary goes.",
      equivalentCommands: ["du -sh <path>"],
      inputSchema: {
        path: z.string().describe("Path to measure"),
        maxDepth: z
          .number()
          .optional()
          .default(1)
          .describe("Depth to summarize"),
        format: z
          .enum(["json", "tsv", "columnar", "bare"])
          .optional()
          .describe("Text block only (default tsv)"),
        fields: z
          .array(z.string())
          .optional()
          .describe("Text-block columns only"),
      },
      outputSchema: {
        // [path, sizeBytes] pairs: an object per row paid both key names on
        // every entry (ADR-0009). sizeHuman is derived, so text view only.
        entries: z.array(z.tuple([z.string(), z.number()])),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ path, maxDepth, format, fields }) => {
      const fmt = (format ?? "tsv") as ListFormat;
      const depth = maxDepth ?? 1;
      // `-k` and `-d` are portable (POSIX; GNU has -d since coreutils 8.6).
      // BSD du has no byte mode, so 1K blocks are the only unit both platforms
      // can report — worth more than Linux's exact bytes, because it makes the
      // payload identical everywhere.
      const result = await exec("du", ["-k", "-d", String(depth), path]);

      if (result.exitCode !== 0) {
        return err(result.stderr);
      }

      const entries = result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sizeStr, ...pathParts] = line.split("\t");
          const sizeBytes = parseInt(sizeStr ?? "0", 10) * 1024;
          return { path: pathParts.join("\t"), sizeBytes };
        });

      const rows = entries.map(({ path: p, sizeBytes }) => ({
        path: p,
        size: humanSize(sizeBytes),
      }));
      return okList(
        { entries: entries.map((e) => [e.path, e.sizeBytes]) },
        rows,
        {},
        fmt,
        { fields },
      );
    },
  );
}
