import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, IS_MACOS } from "#exec";
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
        "Show disk usage for paths. Returns structured size data. The text view omits " +
        "the derived sizeHuman field (computable from sizeBytes); it remains in structuredContent.",
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
      annotations: { readOnlyHint: true },
    },
    async ({ path, maxDepth, format }) => {
      const fmt = (format ?? "tsv") as ListFormat;
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

      const rows = entries.map(({ path: p, sizeBytes }) => ({
        path: p,
        sizeBytes,
      }));
      return okList({ entries }, rows, {}, fmt);
    },
  );
}
