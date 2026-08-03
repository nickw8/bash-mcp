/**
 * JSON Tools
 *
 * Wraps jq for querying and transforming JSON data. Accepts either a
 * file path or raw JSON string as input. Parses jq output back into
 * structured data, handling both single values and multi-line output.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, execWithStdin } from "#exec";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import { parseJsonishOutput } from "../../parsers/json-output.js";

/** Register the jq tool on the MCP server. */
export function registerJsonTools(server: McpServer) {
  defineTool(
    server,
    "jq",
    {
      title: "jq JSON processor",
      description:
        "Query and transform JSON using jq expressions. Accepts a file path or raw JSON string. Returns parsed, structured output — far more compact than reading a full JSON file. " +
        "The filter is passed directly to jq (no shell), so shell-style escaping such as backslash-escaped quotes is neither needed nor supported — write the filter exactly as jq expects it.",
      equivalentCommands: ["jq <filter> <file>"],
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
      annotations: { readOnlyHint: true },
    },
    async ({ filter, file, input, rawOutput, slurp, compact }) => {
      if (!file && !input) {
        return err("Either 'file' or 'input' must be provided");
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
          return err(result.stderr);
        }

        return toJqResult(result.stdout);
      }

      const result = await execWithStdin("jq", args, input ?? "");

      if (result.exitCode !== 0) {
        return err(result.stderr);
      }

      return toJqResult(result.stdout);
    },
  );
}

function toJqResult(stdout: string) {
  const parsed = parseJsonishOutput(stdout);
  switch (parsed.kind) {
    case "single":
      return ok({ result: parsed.value, multiline: false });
    case "multi":
      return ok({ result: parsed.values, multiline: true });
    case "raw":
      return ok({
        result: parsed.text,
        multiline: parsed.text.includes("\n"),
      });
  }
}
