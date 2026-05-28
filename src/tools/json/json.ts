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
import { parseJsonishOutput } from "../../parsers/json-output.js";
import { err, ok } from "#response";

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

        return toJqResult(result.stdout);
      }

      const result = await execWithStdin("jq", args, input ?? "");

      if (result.exitCode !== 0) {
        return err(result.stderr, { result: null, multiline: false });
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
