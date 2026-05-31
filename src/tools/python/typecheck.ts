import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, TIMEOUT } from "#exec";
import { ok } from "#response";
import { defineTool } from "#tool";
import { diagnosticSchema } from "../../parsers/schemas.js";
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
      inputSchema: {
        cwd: z.string().describe("Project root directory"),
        paths: z
          .array(z.string())
          .optional()
          .describe("Specific paths to check (default: '.')"),
      },
      outputSchema: {
        errors: z.array(diagnosticSchema),
        errorCount: z.number(),
        success: z.boolean(),
      },
    },
    async ({ cwd, paths }) => {
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

      return ok({
        errors,
        errorCount: errors.length,
        success: result.exitCode === 0,
      });
    },
  );
}
