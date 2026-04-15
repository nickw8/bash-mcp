/**
 * JSON Tools
 *
 * Wraps jq for querying and transforming JSON data. Accepts either a
 * file path or raw JSON string as input. Parses jq output back into
 * structured data, handling both single values and multi-line output.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { err, ok } from "#response";
import { shellEscape } from "#shell";

/** Register the jq tool on the MCP server. */
export function registerJsonTools(server: McpServer) {
  server.registerTool(
    "jq",
    {
      title: "jq JSON processor",
      description:
        "Query and transform JSON using jq expressions. Accepts a file path or raw JSON string. Returns parsed, structured output — far more compact than reading a full JSON file.",
      inputSchema: {
        filter: z
          .string()
          .optional()
          .default(".")
          .describe("jq filter expression (default: '.')"),
        file: z.string().optional().describe("Path to a JSON file"),
        input: z
          .string()
          .optional()
          .describe("Raw JSON string to process (alternative to file)"),
        rawOutput: z
          .boolean()
          .optional()
          .describe("Output raw strings without JSON encoding (-r)"),
        slurp: z
          .boolean()
          .optional()
          .describe("Read entire input into array (-s)"),
        compact: z.boolean().optional().describe("Compact output (-c)"),
      },
      outputSchema: {
        result: z.union([
          z.record(z.unknown()),
          z.array(z.unknown()),
          z.string(),
          z.number(),
          z.boolean(),
          z.null(),
        ]),
        multiline: z.boolean(),
      },
    },
    async ({ filter, file, input, rawOutput, slurp, compact }) => {
      if (!file && !input) {
        return err("Either 'file' or 'input' must be provided", {
          result: null,
          multiline: false,
        });
      }

      const args: string[] = [];
      if (rawOutput) args.push("-r");
      if (slurp) args.push("-s");
      if (compact) args.push("-c");
      args.push(filter ?? ".");

      if (file) {
        args.push(file);
        const result = await exec("jq", args);

        if (result.exitCode !== 0) {
          return err(result.stderr, { result: null, multiline: false });
        }

        return parseJqOutput(result.stdout, rawOutput);
      }

      // Pipe raw JSON input via stdin (input is guaranteed non-empty by the early return above)
      const result = await exec("sh", [
        "-c",
        `echo ${shellEscape(input ?? "")} | jq ${args.map(shellEscape).join(" ")}`,
      ]);

      if (result.exitCode !== 0) {
        return err(result.stderr, { result: null, multiline: false });
      }

      return parseJqOutput(result.stdout, rawOutput);
    },
  );
}

/**
 * Parse jq output into structured data.
 * Handles three cases: single JSON value, multiple JSON values
 * (one per line), and raw string output (jq -r).
 */
function parseJqOutput(stdout: string, _rawOutput?: boolean) {
  const trimmed = stdout.trim();

  // Try parsing as a single JSON value first
  try {
    const parsed = JSON.parse(trimmed);
    return ok({ result: parsed, multiline: false });
  } catch {
    // jq can output multiple JSON values (one per line)
  }

  // Try parsing each line as a separate JSON value
  const lines = trimmed.split("\n").filter(Boolean);
  const values: unknown[] = [];
  let allParsed = true;

  for (const line of lines) {
    try {
      values.push(JSON.parse(line));
    } catch {
      allParsed = false;
      break;
    }
  }

  if (allParsed && values.length > 0) {
    return ok({ result: values, multiline: true });
  }

  // Raw string output (e.g. jq -r)
  return ok({ result: trimmed, multiline: lines.length > 1 });
}
