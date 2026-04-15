/**
 * YAML Tools
 *
 * Wraps yq (mikefarah/yq) for querying and transforming YAML data.
 * Outputs as JSON by default for structured consumption. Accepts
 * either a file path or raw YAML string as input.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { err, ok } from "#response";
import { shellEscape } from "#shell";

/** Register the yq tool on the MCP server. */
export function registerYamlTools(server: McpServer) {
  server.registerTool(
    "yq",
    {
      title: "yq YAML processor",
      description:
        "Query and transform YAML files using yq expressions (mikefarah/yq). Outputs as JSON for structured consumption. Far more compact than reading a full YAML file.",
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

        return parseYqOutput(result.stdout, fmt);
      }

      // Pipe raw YAML input via stdin (input is guaranteed non-empty by the early return above)
      const result = await exec("sh", [
        "-c",
        `echo ${shellEscape(input ?? "")} | yq ${args.map(shellEscape).join(" ")}`,
      ]);

      if (result.exitCode !== 0) {
        return err(result.stderr, { result: null, format: "error" });
      }

      return parseYqOutput(result.stdout, fmt);
    },
  );
}

/**
 * Parse yq output into structured data.
 * When format is JSON, parses into objects. Multi-document YAML
 * produces multiple JSON objects (one per line). YAML/props
 * output is returned as a raw string.
 */
function parseYqOutput(stdout: string, format: string) {
  const trimmed = stdout.trim();

  // When output is JSON, parse into structured data
  if (format === "json") {
    try {
      const parsed = JSON.parse(trimmed);
      return ok({ result: parsed, format });
    } catch {
      // Multi-document YAML outputs multiple JSON objects, one per line
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
        return ok({ result: values, format });
      }
    }
  }

  // YAML or props output — return as string
  return ok({ result: trimmed, format });
}
