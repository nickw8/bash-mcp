import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TIMEOUT, exec } from "#exec";
import { err, ok } from "#response";
import { parseVitestResults } from "./parsers/vitest.js";

/** Register the npm_test tool for structured vitest results. */
export function registerNpmTestTool(server: McpServer) {
  server.registerTool(
    "npm_test",
    {
      title: "Test (structured)",
      description:
        "Run vitest and return structured test results: suites, pass/fail counts, failure messages. " +
        "Much more compact than raw test output.",
      inputSchema: {
        cwd: z.string().describe("Project root directory"),
        pattern: z
          .string()
          .optional()
          .describe("Filter tests by filename pattern"),
        coverage: z.boolean().optional().describe("Enable coverage reporting"),
      },
      outputSchema: {
        suites: z.array(
          z.object({
            file: z.string(),
            passed: z.number(),
            failed: z.number(),
            skipped: z.number(),
            duration: z.number(),
            tests: z.array(
              z.object({
                name: z.string(),
                status: z.enum(["passed", "failed", "skipped"]),
                duration: z.number(),
                failureMessage: z.string().optional(),
              }),
            ),
          }),
        ),
        summary: z.object({
          total: z.number(),
          passed: z.number(),
          failed: z.number(),
          skipped: z.number(),
          duration: z.number(),
        }),
      },
    },
    async ({ cwd, pattern, coverage }) => {
      const args = ["vitest", "run", "--reporter=json"];
      if (pattern) args.push(pattern);
      if (coverage) args.push("--coverage");

      const result = await exec("npx", args, { cwd, timeout: TIMEOUT.BUILD });

      // vitest exits non-zero on test failures but still outputs JSON
      const output = result.stdout || result.stderr;
      if (!output.trim()) {
        return err("No test output received", {
          suites: [],
          summary: {
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            duration: 0,
          },
        });
      }

      try {
        // vitest may prefix JSON with non-JSON lines (deprecation warnings, etc.)
        // Find the first { and parse from there
        const jsonStart = output.indexOf("{");
        if (jsonStart < 0) throw new Error("No JSON found in output");
        const jsonStr = output.slice(jsonStart);

        const { suites, summary } = parseVitestResults(jsonStr);
        return ok({ suites, summary });
      } catch {
        return err("Failed to parse vitest JSON output", {
          suites: [],
          summary: {
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            duration: 0,
          },
        });
      }
    },
  );
}
