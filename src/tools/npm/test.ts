import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TIMEOUT } from "#exec";
import { onlyFailures, testResultSchema, testRun } from "#parsers";
import { defineTool } from "#tool";
import { parseVitestResults } from "./parsers/vitest.js";

/** Register the npm_test tool for structured vitest results. */
export function registerNpmTestTool(server: McpServer) {
  defineTool(
    server,
    "npm_test",
    {
      title: "Test (structured)",
      description:
        "Run vitest and return structured test results: suites, pass/fail counts, failure messages. " +
        "Much more compact than raw test output. Only failures are listed by default; use verbose=true for all tests.",
      equivalentCommands: ["npm test"],
      required: ["cwd"],
      inputSchema: {
        cwd: z.string().optional().describe("Project root directory"),
        pattern: z
          .string()
          .optional()
          .describe("Filter tests by filename pattern"),
        coverage: z.boolean().optional().describe("Enable coverage reporting"),
        verbose: z
          .boolean()
          .optional()
          .describe("Include all tests in output (default: only failures)"),
      },
      outputSchema: {
        suites: z.array(
          z.object({
            file: z.string(),
            passed: z.number(),
            failed: z.number(),
            skipped: z.number(),
            duration: z.number(),
            tests: z.array(testResultSchema),
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
    async ({ cwd, pattern, coverage, verbose }) => {
      const args = ["vitest", "run", "--reporter=json"];
      if (pattern) args.push(pattern);
      if (coverage) args.push("--coverage");

      // vitest exits non-zero on test failures but still outputs JSON
      return testRun({
        command: "npx",
        args: () => args,
        artifact: "stdout",
        cwd,
        timeout: TIMEOUT.BUILD,
        parse: (output: string) => {
          // vitest may prefix JSON with non-JSON lines (deprecation warnings, etc.)
          const jsonStart = output.indexOf("{");
          if (jsonStart < 0) throw new Error("No JSON found in output");
          return parseVitestResults(output.slice(jsonStart));
        },
        payload: ({ suites, summary }) => ({
          suites: onlyFailures(suites, verbose),
          summary,
        }),
      });
    },
  );
}
