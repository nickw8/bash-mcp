import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TIMEOUT } from "#exec";
import { onlyFailures, testResultSchema, testRun } from "#parsers";
import { defineTool } from "#tool";
import { parsePytestResults } from "./parsers/pytest.js";

export function registerPythonTestTool(server: McpServer) {
  defineTool(
    server,
    "python_test",
    {
      title: "Python test (structured)",
      description:
        "Run pytest and return structured test results: suites, pass/fail counts, failure messages. " +
        "Much more compact than raw test output. Only failures are listed by default; use verbose=true for all tests.",
      equivalentCommands: ["pytest"],
      inputSchema: {
        cwd: z.string().describe("Project root directory"),
        pattern: z
          .string()
          .optional()
          .describe("Filter tests by expression (-k pattern)"),
        path: z
          .string()
          .optional()
          .describe("Specific test path or file to run"),
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
    async ({ cwd, pattern, path, verbose }) => {
      return testRun({
        command: "python3",
        args: (xmlPath) => {
          const args = ["-m", "pytest", `--junitxml=${xmlPath}`, "-q"];
          if (pattern) args.push("-k", pattern);
          if (path) args.push(path);
          return args;
        },
        artifact: "file",
        cwd,
        timeout: TIMEOUT.BUILD,
        parse: parsePytestResults,
        payload: ({ suites, summary }) => ({
          suites: onlyFailures(suites, verbose),
          summary,
        }),
      });
    },
  );
}
