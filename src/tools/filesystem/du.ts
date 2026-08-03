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
        "Show disk usage for paths. Returns one { path, sizeBytes } entry per path, largest-first ordering as du emits it. " +
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
          .describe("Output format (default: tsv)"),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            "Limit the text view to these columns (text block only, not the returned payload)",
          ),
      },
      outputSchema: {
        // sizeHuman is derived from sizeBytes, so it is rendered in the text
        // view only — the payload pays for one of the two (ADR-0009).
        entries: z.array(
          z.object({
            path: z.string(),
            sizeBytes: z.number(),
          }),
        ),
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
      return okList({ entries }, rows, {}, fmt, { fields });
    },
  );
}
