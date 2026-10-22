import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, TIMEOUT } from "#exec";
import {
  diagnosticInputSchema,
  diagnosticOutputSchema,
  diagnosticRun,
  stringOrArray,
  toArray,
} from "#parsers";
import { defineTool } from "#tool";
import { parseShellcheckDiagnostics } from "./parsers/shellcheck.js";

export function registerBashLintTool(server: McpServer) {
  defineTool(
    server,
    "bash_lint",
    {
      title: "Bash lint (structured)",
      description:
        "Run shellcheck and return structured diagnostics with file, line, column, message, and SC rule code. " +
        "Much more compact than raw shellcheck output. Use minSeverity to filter by severity level.",
      equivalentCommands: ["shellcheck -f json1 script.sh"],
      required: ["files"],
      inputSchema: {
        files: stringOrArray("Shell script path(s) to lint; a string or array"),
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
      },
      annotations: { readOnlyHint: true },
    },
    async ({ files, minSeverity, format, fields, detailLevel, maxItems }) => {
      const result = await exec(
        "shellcheck",
        ["-f", "json1", ...toArray(files)],
        { timeout: TIMEOUT.DEFAULT },
      );

      return diagnosticRun({
        command: "shellcheck",
        results: result,
        parse: parseShellcheckDiagnostics,
        minSeverity,
        bareWhen: "no-findings",
        format,
        textFields: fields,
        detailLevel,
        maxItems,
      });
    },
  );
}
