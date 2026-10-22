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
        paths: stringOrArray(
          "Specific path(s) to check; a string or array (default: '.')",
        ),
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
      const pathList = toArray(paths);
      const args = [
        "--show-column-numbers",
        "--no-color-output",
        "--no-error-summary",
        ...(pathList.length > 0 ? pathList : ["."]),
      ];

      const result = await exec("mypy", args, {
        cwd,
        timeout: TIMEOUT.TYPECHECK,
      });

      return diagnosticRun({
        command: "mypy",
        results: result,
        parse: parseMypyOutput,
        count: "total",
        fields: (_, [r]) => ({ success: r?.exitCode === 0 }),
        metaKeys: ["errorCount"],
        format,
        textFields: fields,
        detailLevel,
        maxItems,
      });
    },
  );
}
