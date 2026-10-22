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
import { parseRuffDiagnostics } from "./parsers/ruff.js";

export function registerPythonLintTool(server: McpServer) {
  defineTool(
    server,
    "python_lint",
    {
      title: "Python lint (structured)",
      description:
        "Run ruff check and return structured diagnostics with file, line, column, message, and rule code. " +
        "Much more compact than raw ruff output. Use minSeverity to filter by severity level.",
      equivalentCommands: ["ruff check ."],
      inputSchema: {
        cwd: z.string().describe("Project root directory"),
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
      const args = ["check", "--output-format", "json"];
      if (fix) args.push("--fix");
      const pathList = toArray(paths);
      args.push(...(pathList.length > 0 ? pathList : ["."]));

      const result = await exec("ruff", args, { cwd, timeout: 30_000 });

      return diagnosticRun({
        results: result,
        parse: parseRuffDiagnostics,
        minSeverity,
        fixedPattern: /Fixed (\d+) file/,
        bareWhen: "blank-output",
        onParseError: (output) =>
          err("Failed to parse ruff JSON output", {
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
