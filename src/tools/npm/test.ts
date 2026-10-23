import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TIMEOUT } from "#exec";
import { onlyFailures, testResultSchema, testRun } from "#parsers";
import { defineTool } from "#tool";
import { parseVitestResults } from "./parsers/vitest.js";

/**
 * The project's test runner: jest when package.json depends on jest and not
 * vitest, otherwise vitest — which also covers a workspace package whose
 * vitest is hoisted to the root and absent from its own package.json.
 */
export function detectRunner(cwd: string | undefined): "vitest" | "jest" {
  try {
    const pkg = JSON.parse(
      readFileSync(join(cwd ?? ".", "package.json"), "utf8"),
    );
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return deps.jest && !deps.vitest ? "jest" : "vitest";
  } catch {
    return "vitest";
  }
}

/** Register the npm_test tool for structured vitest or jest results. */
export function registerNpmTestTool(server: McpServer) {
  defineTool(
    server,
    "npm_test",
    {
      title: "Test (structured)",
      description:
        "Run vitest or jest (picked from package.json) and return structured test results: suites, pass/fail counts, failure messages. " +
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
      // Vitest's JSON reporter writes jest's report format, so one parser
      // reads both.
      const args =
        detectRunner(cwd) === "jest"
          ? ["jest", "--json"]
          : ["vitest", "run", "--reporter=json"];
      if (pattern) args.push(pattern);
      if (coverage) args.push("--coverage");

      // both exit non-zero on test failures but still output JSON
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
