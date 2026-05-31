import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import { countBySeverity, diagnosticSchema } from "../../parsers/schemas.js";
import { parseBiomeDiagnostics } from "./parsers/biome.js";

/** Register the npm_lint tool for structured biome diagnostics. */
export function registerNpmLintTool(server: McpServer) {
  defineTool(
    server,
    "npm_lint",
    {
      title: "Lint (structured)",
      description:
        "Run biome check and return structured diagnostics with file, line, column, message, and rule. " +
        "Far more compact and parseable than raw lint output. Use minSeverity to filter by severity level.",
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
      const args = ["biome", "check", "--reporter=json"];
      if (fix) args.push("--fix");
      args.push(...(paths ?? ["."]));

      const result = await exec("npx", args, { cwd, timeout: 30_000 });

      // biome exits non-zero when there are errors, but still outputs JSON
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
        let diagnostics = parseBiomeDiagnostics(output);
        const { errorCount, warningCount } = countBySeverity(diagnostics);

        if (minSeverity) {
          const severityRank = { error: 3, warning: 2, info: 1 } as const;
          const minRank = severityRank[minSeverity];
          diagnostics = diagnostics.filter(
            (d) => severityRank[d.severity] >= minRank,
          );
        }

        // Parse fixed count from biome's output if available
        const fixedMatch = output.match(/Fixed (\d+) file/);
        const fixedCount = fixedMatch ? parseInt(fixedMatch[1] ?? "0", 10) : 0;

        return ok({
          errors: diagnostics,
          errorCount,
          warningCount,
          fixedCount,
        });
      } catch {
        // JSON parse failed — return raw output as a single diagnostic
        return err("Failed to parse biome JSON output", {
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
