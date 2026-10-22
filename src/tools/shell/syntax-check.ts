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
      required: ["files"],
      inputSchema: {
        files: stringOrArray(
          "Shell script path(s) to check; a string or array",
        ),
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
        toArray(files).map((file) =>
          exec("bash", ["-n", file], { timeout: TIMEOUT.DEFAULT }),
        ),
      );
      return diagnosticRun({
        results,
        parse: parseBashSyntax,
        stream: "stderr",
        count: "total",
        fields: ({ errorCount }) => ({ valid: errorCount === 0 }),
        bareWhen: "no-findings",
        format,
        textFields: fields,
        detailLevel,
        maxItems,
      });
    },
  );
}
