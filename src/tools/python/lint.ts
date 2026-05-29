import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { err, ok } from "#response";
import { countBySeverity, diagnosticSchema } from "../../parsers/schemas.js";
import { parseRuffDiagnostics } from "./parsers/ruff.js";

export function registerPythonLintTool(server: McpServer) {
  server.registerTool(
    "python_lint",
    {
      title: "Python lint (structured)",
      description:
        "Run ruff check and return structured diagnostics with file, line, column, message, and rule code. " +
        "Much more compact than raw ruff output. Use minSeverity to filter by severity level.",
      inputSchema: {
        cwd: z.string().describe("Project root directory"),
        fix: z
          .boolean()
          .optional()
          .describe("Auto-fix safe issues (default: false)"),
        paths: z
          .array(z.string())
          .optional()
          .describe("Specific paths to lint (default: '.')"),
        minSeverity: z
          .enum(["error", "warning", "info"])
          .optional()
          .describe(
            "Minimum severity to include (e.g. 'error' drops warnings and info)",
          ),
      },
      outputSchema: {
        errors: z.array(diagnosticSchema),
        errorCount: z.number(),
        warningCount: z.number(),
        fixedCount: z.number(),
      },
    },
    async ({ cwd, fix, paths, minSeverity }) => {
      const args = ["check", "--output-format", "json"];
      if (fix) args.push("--fix");
      args.push(...(paths ?? ["."]));

      const result = await exec("ruff", args, { cwd, timeout: 30_000 });

      const output = result.stdout || result.stderr;
      if (!output.trim()) {
        return ok({
          errors: [],
          errorCount: 0,
          warningCount: 0,
          fixedCount: 0,
        });
      }

      try {
        let diagnostics = parseRuffDiagnostics(output);
        const { errorCount, warningCount } = countBySeverity(diagnostics);

        if (minSeverity) {
          const severityRank = { error: 3, warning: 2, info: 1 } as const;
          const minRank = severityRank[minSeverity];
          diagnostics = diagnostics.filter(
            (d) => severityRank[d.severity] >= minRank,
          );
        }

        const fixedMatch = output.match(/Fixed (\d+) file/);
        const fixedCount = fixedMatch ? parseInt(fixedMatch[1] ?? "0", 10) : 0;

        return ok({
          errors: diagnostics,
          errorCount,
          warningCount,
          fixedCount,
        });
      } catch {
        return err("Failed to parse ruff JSON output", {
          errors: [
            {
              file: "",
              line: 0,
              column: 0,
              message: output.slice(0, 500),
              severity: "error" as const,
            },
          ],
          errorCount: 1,
          warningCount: 0,
          fixedCount: 0,
        });
      }
    },
  );
}
