import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, TIMEOUT } from "#exec";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import { testResultSchema } from "../../parsers/schemas.js";
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
      const xmlPath = join(tmpdir(), `bash-mcp-pytest-${Date.now()}.xml`);
      const args = ["-m", "pytest", `--junitxml=${xmlPath}`, "-q"];
      if (pattern) args.push("-k", pattern);
      if (path) args.push(path);

      const result = await exec("python3", args, {
        cwd,
        timeout: TIMEOUT.BUILD,
      });

      let xmlContent: string | undefined;
      try {
        xmlContent = readFileSync(xmlPath, "utf8");
      } catch {
        // XML file may not exist if pytest failed before producing output
      } finally {
        try {
          rmSync(xmlPath, { force: true });
        } catch {
          // Best-effort cleanup
        }
      }

      if (!xmlContent) {
        const output = `${result.stdout}\n${result.stderr}`.trim();
        return err(output.slice(0, 500) || "No test output received", {
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

      const { suites, summary } = parsePytestResults(xmlContent);

      if (!verbose) {
        for (const suite of suites) {
          suite.tests = suite.tests.filter((t) => t.status === "failed");
        }
      }

      return ok({ suites, summary });
    },
  );
}
