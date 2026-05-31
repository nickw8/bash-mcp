import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, TIMEOUT } from "#exec";
import { ok } from "#response";
import { defineTool } from "#tool";
import { diagnosticSchema } from "../../parsers/schemas.js";
import { parseTscOutput } from "./parsers/tsc.js";

/** Register the npm_typecheck tool for structured tsc/tsgo type errors. */
export function registerNpmTypecheckTool(server: McpServer) {
  defineTool(
    server,
    "npm_typecheck",
    {
      title: "Type check (structured)",
      description:
        "Run tsc/tsgo --noEmit and return structured type errors with file, line, column, message, and TS error code. " +
        "Much more compact than raw tsc output. Auto-detects tsgo for faster checking. Use project to specify a tsconfig.",
      inputSchema: {
        cwd: z.string().describe("Project root directory"),
        project: z
          .string()
          .optional()
          .describe("Path to tsconfig.json (default: auto-detected by tsc)"),
      },
      outputSchema: {
        errors: z.array(diagnosticSchema),
        errorCount: z.number(),
        success: z.boolean(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, project }) => {
      // Try tsgo first (faster), fall back to tsc
      const compiler = await detectCompiler(cwd);
      const args = [compiler, "--noEmit", "--pretty", "false"];
      if (project) args.push("-p", project);

      const result = await exec("npx", args, {
        cwd,
        timeout: TIMEOUT.TYPECHECK,
      });

      const output = result.stdout || result.stderr;
      const errors = parseTscOutput(output);

      return ok({
        errors,
        errorCount: errors.length,
        success: result.exitCode === 0,
      });
    },
  );
}

/** Detect whether tsgo or tsc is available, preferring tsgo. */
async function detectCompiler(cwd: string): Promise<string> {
  const tsgo = await exec("npx", ["tsgo", "--version"], {
    cwd,
    timeout: 5_000,
  });
  if (tsgo.exitCode === 0) return "tsgo";
  return "tsc";
}
