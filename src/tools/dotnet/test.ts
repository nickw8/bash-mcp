/**
 * dotnet_test tool — structured test results via TRX parsing.
 *
 * Wraps `dotnet test` and parses TRX (Visual Studio Test Results) XML into
 * typed results with pass/fail/skip counts and failure details. Uses TRX
 * format instead of console output for reliable machine parsing.
 *
 * Passing tests are omitted from the response — only failures are listed.
 * A fully green run returns just the summary counts, keeping token usage
 * minimal for the common case.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TIMEOUT } from "#exec";
import { testResultSchema, testRun } from "#parsers";
import { defineTool } from "#tool";
import { detectSolution } from "./detect.js";
import { aggregateTrx } from "./parsers/trx.js";

/** Register the dotnet_test tool for structured test results. */
export function registerDotnetTestTool(server: McpServer) {
  defineTool(
    server,
    "dotnet_test",
    {
      title: "Test (structured)",
      description:
        "Run dotnet test and return structured results: pass/fail/skip counts, failure messages. " +
        "Much more compact than raw test output. Only failures are listed.",
      equivalentCommands: ["dotnet test"],
      required: ["cwd"],
      inputSchema: {
        cwd: z.string().optional().describe("Project root directory"),
        filter: z
          .string()
          .optional()
          .describe(
            "Test filter expression (e.g. 'FullyQualifiedName~MyTest')",
          ),
        project: z
          .string()
          .optional()
          .describe(
            "Path to .csproj or .sln file (default: auto-detected in cwd)",
          ),
      },
      outputSchema: {
        exitCode: z.number(),
        passed: z.number(),
        failed: z.number(),
        skipped: z.number(),
        total: z.number(),
        failures: z.array(testResultSchema),
        summary: z.string(),
      },
    },
    // Empty fallback for a `required` argument — see the note in batch.ts.
    async ({ cwd = "", filter, project }) => {
      const args = ["test"];

      const target = project ?? detectSolution(cwd);
      if (target) args.push(target);

      if (filter) args.push("--filter", filter);

      // One TRX per test project in a multi-project run
      return testRun({
        command: "dotnet",
        args: (resultsDir) => [
          ...args,
          "--logger:trx",
          `--results-directory:${resultsDir}`,
        ],
        artifact: "dir",
        suffix: ".trx",
        cwd,
        timeout: TIMEOUT.BUILD,
        parse: aggregateTrx,
        errorFields: (r) => ({
          exitCode: r.exitCode,
          summary: "No TRX output produced",
        }),
        payload: ({ results, passed, failed, skipped, total }, r) => {
          const parts: string[] = [];
          if (passed > 0) parts.push(`${passed} passed`);
          if (failed > 0) parts.push(`${failed} failed`);
          if (skipped > 0) parts.push(`${skipped} skipped`);
          return {
            exitCode: r.exitCode,
            passed,
            failed,
            skipped,
            total,
            failures: results,
            summary: parts.join(", ") || "0 tests",
          };
        },
      });
    },
  );
}
