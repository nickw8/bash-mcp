import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { err, ok } from "#response";
import { parseBiomeDiagnostics } from "./parsers/biome.js";

/** Register the npm_lint tool for structured biome diagnostics. */
export function registerNpmLintTool(server: McpServer) {
  server.registerTool(
    "npm_lint",
    {
      title: "Lint (structured)",
      description:
        "Run biome check and return structured diagnostics with file, line, column, message, and rule. " +
        "Far more compact and parseable than raw lint output.",
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
      },
      outputSchema: {
        errors: z.array(
          z.object({
            file: z.string(),
            line: z.number(),
            column: z.number(),
            message: z.string(),
            severity: z.enum(["error", "warning", "info"]),
            rule: z.string().optional(),
          }),
        ),
        errorCount: z.number(),
        warningCount: z.number(),
        fixedCount: z.number(),
      },
    },
    async ({ cwd, fix, paths }) => {
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
        const diagnostics = parseBiomeDiagnostics(output);
        const errorCount = diagnostics.filter(
          (d) => d.severity === "error",
        ).length;
        const warningCount = diagnostics.filter(
          (d) => d.severity === "warning",
        ).length;

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
