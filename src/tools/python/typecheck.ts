import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, TIMEOUT } from "#exec";
import {
  diagnosticInputSchema,
  diagnosticOutputSchema,
  diagnosticsResponse,
} from "#parsers";
import { defineTool } from "#tool";
import { parseMypyOutput } from "./parsers/mypy.js";

export function registerPythonTypecheckTool(server: McpServer) {
  defineTool(
    server,
    "python_typecheck",
    {
      title: "Python type check (structured)",
      description:
        "Run mypy and return structured type errors with file, line, column, message, and error code. " +
        "Much more compact than raw mypy output.",
      equivalentCommands: ["mypy ."],
      inputSchema: {
        cwd: z.string().describe("Project root directory"),
        paths: z
          .array(z.string())
          .optional()
          .describe("Specific paths to check (default: '.')"),
        ...diagnosticInputSchema,
      },
      outputSchema: {
        ...diagnosticOutputSchema,
        errorCount: z.number(),
        success: z.boolean(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, paths, format, fields, detailLevel, maxItems }) => {
      const args = [
        "--show-column-numbers",
        "--no-color-output",
        "--no-error-summary",
        ...(paths ?? ["."]),
      ];

      const result = await exec("mypy", args, {
        cwd,
        timeout: TIMEOUT.TYPECHECK,
      });

      const output = result.stdout || result.stderr;
      const errors = parseMypyOutput(output);

      return diagnosticsResponse(
        { errorCount: errors.length, success: result.exitCode === 0 },
        errors,
        {
          format,
          fields,
          budget: { detailLevel, maxItems },
          meta: { errorCount: errors.length },
        },
      );
    },
  );
}
