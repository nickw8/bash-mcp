import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, TIMEOUT } from "#exec";
import type { TestResult } from "#parsers";
import { err, ok } from "#response";
import { checkCommandAllowed } from "#safety";
import { defineTool } from "#tool";
import { parseBashTest } from "./parsers/bash-test.js";

/**
 * Split TAP results into passed/failed/skipped (ADR-0009). Bats reports no
 * timings — every case carried `duration: 0` and a `status` string that the
 * bucket now says — so a passed or skipped case costs just its name.
 */
function partition(tests: TestResult[]) {
  const passed: string[] = [];
  const skipped: string[] = [];
  const failed: { name: string; message?: string }[] = [];
  for (const t of tests) {
    if (t.status === "passed") passed.push(t.name);
    else if (t.status === "skipped") skipped.push(t.name);
    else
      failed.push({
        name: t.name,
        ...(t.failureMessage ? { message: t.failureMessage } : {}),
      });
  }
  return { passed, failed, skipped };
}

export function registerBashTestTool(server: McpServer) {
  defineTool(
    server,
    "bash_test",
    {
      title: "Bash test (structured)",
      description:
        "Run a shell test script — bats `.bats` files via `--tap`, or a plain `.sh` harness — and return structured results: " +
        "per-case pass/fail plus a summary parsed from TAP or `N tests, M failures` output, falling back to exit-code-only when the format is unrecognized. " +
        "Executes the script, so it is gated by BASH_MCP_MODE.",
      equivalentCommands: ["bats --tap test.bats", "bash test.sh"],
      inputSchema: {
        file: z.string().describe("Test script path (.bats or .sh)"),
        cwd: z.string().optional().describe("Working directory"),
        timeout: z
          .number()
          .optional()
          .default(TIMEOUT.BUILD)
          .describe("Timeout in ms"),
      },
      outputSchema: {
        summary: z
          .object({
            passed: z.number(),
            failed: z.number(),
            total: z.number(),
          })
          .nullable(),
        passed: z.array(z.string()),
        failed: z.array(
          z.object({ name: z.string(), message: z.string().optional() }),
        ),
        skipped: z.array(z.string()),
        exitCode: z.number(),
      },
    },
    async ({ file, cwd, timeout }) => {
      // bats emits TAP with --tap; a plain .sh harness is run directly.
      const isBats = file.endsWith(".bats");
      const command = isBats ? "bats" : "bash";
      const args = isBats ? ["--tap", file] : [file];

      // Running a script is a mutating action — gate it through the shared
      // BASH_MCP_MODE chokepoint (same guard as run/batch).
      const gate = checkCommandAllowed(command, args);
      if (!gate.allowed) {
        const reason = gate.reason ?? "blocked by BASH_MCP_MODE";
        return err(
          reason,
          { exitCode: 126 },
          { kind: "permission_denied", message: reason, command },
        );
      }

      const result = await exec(command, args, { cwd, timeout });

      if (result.errorCode === "ENOENT") {
        return err(
          `${command} is not installed.`,
          { exitCode: 127 },
          {
            kind: "missing_binary",
            message: `${command} not found on PATH`,
            command,
            suggestion: `Install '${command}' or ensure it is on PATH.`,
          },
        );
      }

      const { summary, tests } = parseBashTest(
        `${result.stdout}\n${result.stderr}`,
      );
      return ok({
        summary,
        ...partition(tests),
        exitCode: result.exitCode,
      });
    },
  );
}
