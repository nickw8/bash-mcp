import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, TIMEOUT } from "#exec";
import {
  countBySeverity,
  diagnosticInputSchema,
  diagnosticOutputSchema,
  diagnosticsResponse,
} from "#parsers";
import { err, ok } from "#response";
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
      inputSchema: {
        files: z
          .array(z.string())
          .min(1)
          .describe("Shell script paths to lint"),
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
      const result = await exec("shellcheck", ["-f", "json1", ...files], {
        timeout: TIMEOUT.DEFAULT,
      });

      // shellcheck not installed → structured notice rather than a crash.
      if (result.errorCode === "ENOENT") {
        return err(
          "shellcheck is not installed. Install it to enable bash_lint (https://www.shellcheck.net).",
          undefined,
          {
            kind: "missing_binary",
            message: "shellcheck not found on PATH",
            command: "shellcheck",
            suggestion: "Install 'shellcheck' or ensure it is on PATH.",
          },
        );
      }

      let diagnostics = parseShellcheckDiagnostics(
        result.stdout || result.stderr,
      );
      const { errorCount, warningCount } = countBySeverity(diagnostics);

      if (minSeverity) {
        const severityRank = { error: 3, warning: 2, info: 1 } as const;
        const minRank = severityRank[minSeverity];
        diagnostics = diagnostics.filter(
          (d) => severityRank[d.severity] >= minRank,
        );
      }

      if (diagnostics.length === 0) {
        return ok({ errors: [], errorCount, warningCount });
      }

      return diagnosticsResponse({ errorCount, warningCount }, diagnostics, {
        format,
        fields,
        budget: { detailLevel, maxItems },
        meta: { errorCount, warningCount },
      });
    },
  );
}
