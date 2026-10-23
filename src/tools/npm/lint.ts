import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import {
  diagnosticInputSchema,
  diagnosticOutputSchema,
  diagnosticRun,
  stringOrArray,
  toArray,
} from "#parsers";
import { err } from "#response";
import { defineTool } from "#tool";
import { biomeChangedCount, parseBiomeDiagnostics } from "./parsers/biome.js";

/** Register the npm_lint tool for structured biome diagnostics. */
export function registerNpmLintTool(server: McpServer) {
  defineTool(
    server,
    "npm_lint",
    {
      title: "Lint (structured)",
      description:
        "Run biome check and return structured diagnostics with file, line, column, message, and rule. " +
        "Far more compact and parseable than raw lint output. Use minSeverity to filter by severity level.",
      equivalentCommands: ["npm run lint"],
      required: ["cwd"],
      inputSchema: {
        cwd: z.string().optional().describe("Project root directory"),
        fix: z
          .boolean()
          .optional()
          .describe("Auto-fix safe issues (default: false)"),
        paths: stringOrArray(
          "Specific path(s) to lint; a string or array (default: '.')",
        ),
        minSeverity: z
          .enum(["error", "warning", "info"])
          .optional()
          .describe(
            "Minimum severity to include (e.g. 'error' drops warnings and info)",
          ),
        ...diagnosticInputSchema,
      },
      outputSchema: {
        ...diagnosticOutputSchema,
        errorCount: z.number(),
        warningCount: z.number(),
        fixedCount: z.number(),
      },
    },
    async ({
      cwd,
      fix,
      paths,
      minSeverity,
      format,
      fields,
      detailLevel,
      maxItems,
    }) => {
      const args = ["biome", "check", "--reporter=json"];
      if (fix) args.push("--fix");
      const pathList = toArray(paths);
      args.push(...(pathList.length > 0 ? pathList : ["."]));

      const result = await exec("npx", args, { cwd, timeout: 30_000 });

      // biome exits non-zero when there are errors, but still outputs JSON
      return diagnosticRun({
        command: "biome",
        results: result,
        parse: parseBiomeDiagnostics,
        minSeverity,
        fields: (_counts, [r]) => ({
          fixedCount: fix ? biomeChangedCount(r?.stdout || r?.stderr || "") : 0,
        }),
        bareWhen: "blank-output",
        // JSON parse failed — return raw output as a single diagnostic
        onParseError: (output) =>
          err("Failed to parse biome JSON output", {
            errors: [{ file: "", items: [`0:0 ${output.slice(0, 500)}`] }],
            errorCount: 1,
          }),
        format,
        textFields: fields,
        detailLevel,
        maxItems,
      });
    },
  );
}
