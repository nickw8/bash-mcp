/**
 * YAML Tools
 *
 * Wraps yq (mikefarah/yq) for querying and transforming YAML data.
 * Outputs as JSON by default for structured consumption. Accepts
 * either a file path or raw YAML string as input.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, execWithStdin } from "#exec";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import { parseJsonishOutput } from "../../parsers/json-output.js";

/** Register the yq tool on the MCP server. */
export function registerYamlTools(server: McpServer) {
  defineTool(
    server,
    "yq",
    {
      title: "yq YAML processor",
      description:
        "Query and transform YAML files using yq expressions (mikefarah/yq). Outputs as JSON for structured consumption. Far more compact than reading a full YAML file.",
      equivalentCommands: ["yq <filter> <file>"],
      inputSchema: {
        expression: z
          .string()
          .optional()
          .default(".")
          .describe("yq expression (default: '.')"),
        file: z.string().optional().describe("Path to a YAML file"),
        input: z
          .string()
          .optional()
          .describe("Raw YAML string to process (alternative to file)"),
        outputFormat: z
          .enum(["json", "yaml", "props"])
          .optional()
          .default("json")
          .describe("Output format (default: 'json' for structured output)"),
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
        format: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ expression, file, input, outputFormat }) => {
      if (!file && !input) {
        return err("Either 'file' or 'input' must be provided", {
          result: null,
          format: "error",
        });
      }

      const fmt = outputFormat ?? "json";
      const args: string[] = ["-o", fmt, expression ?? "."];

      if (file) {
        args.push(file);
        const result = await exec("yq", args);

        if (result.exitCode !== 0) {
          return err(result.stderr, { result: null, format: "error" });
        }

        return toYqResult(result.stdout, fmt);
      }

      const result = await execWithStdin("yq", args, input ?? "");

      if (result.exitCode !== 0) {
        return err(result.stderr, { result: null, format: "error" });
      }

      return toYqResult(result.stdout, fmt);
    },
  );
}

function toYqResult(stdout: string, format: string) {
  if (format !== "json") {
    return ok({ result: stdout.trim(), format });
  }

  const parsed = parseJsonishOutput(stdout);
  switch (parsed.kind) {
    case "single":
      return ok({ result: parsed.value, format });
    case "multi":
      return ok({ result: parsed.values, format });
    case "raw":
      return ok({ result: parsed.text, format });
  }
}
