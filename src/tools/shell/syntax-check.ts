import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, TIMEOUT } from "#exec";
import { ok } from "#response";
import { defineTool } from "#tool";
import {
  diagnosticInputSchema,
  diagnosticOutputSchema,
  diagnosticsResponse,
} from "../../parsers/diagnostics-response.js";
import { parseBashSyntax } from "./parsers/bash-syntax.js";

export function registerBashSyntaxCheckTool(server: McpServer) {
  defineTool(
    server,
    "bash_syntax_check",
    {
      title: "Bash syntax check (structured)",
      description:
        "Check shell scripts for syntax errors with `bash -n` and return structured diagnostics (file, line, message). " +
        "Parses without executing, so it is safe on untrusted scripts. Reports valid:true when no errors are found.",
      equivalentCommands: ["bash -n script.sh"],
      inputSchema: {
        files: z
          .array(z.string())
          .min(1)
          .describe("Shell script paths to check"),
        ...diagnosticInputSchema,
      },
      outputSchema: {
        ...diagnosticOutputSchema,
        errorCount: z.number(),
        valid: z.boolean(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ files, format, fields, detailLevel, maxItems }) => {
      // `bash -n` parses a single script file (extra args become positional
      // params), so check each file separately and merge the diagnostics.
      const results = await Promise.all(
        files.map((file) =>
          exec("bash", ["-n", file], { timeout: TIMEOUT.DEFAULT }),
        ),
      );
      const diagnostics = results.flatMap((r) => parseBashSyntax(r.stderr));
      const errorCount = diagnostics.length;

      if (errorCount === 0) return ok({ errors: [], errorCount, valid: true });

      return diagnosticsResponse({ errorCount, valid: false }, diagnostics, {
        format,
        fields,
        budget: { detailLevel, maxItems },
        meta: { errorCount, valid: false },
      });
    },
  );
}
