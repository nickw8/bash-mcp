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

import { readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { err, ok } from "#response";
import { parseTrxResults } from "./parsers/trx.js";

/** Register the dotnet_test tool for structured test results. */
export function registerDotnetTestTool(server: McpServer) {
  server.registerTool(
    "dotnet_test",
    {
      title: "Test (structured)",
      description:
        "Run dotnet test and return structured results: pass/fail/skip counts, failure messages. " +
        "Much more compact than raw test output. Only failures are listed.",
      inputSchema: {
        cwd: z.string().describe("Project root directory"),
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
        failures: z.array(
          z.object({
            name: z.string(),
            status: z.enum(["passed", "failed", "skipped"]),
            duration: z.number(),
            failureMessage: z.string().optional(),
          }),
        ),
        summary: z.string(),
      },
    },
    async ({ cwd, filter, project }) => {
      // Create a temp directory for TRX output
      const resultsDir = join(tmpdir(), `bash-mcp-trx-${Date.now()}`);

      const args = ["test"];

      const target = project ?? detectSolution(cwd);
      if (target) args.push(target);

      if (filter) args.push("--filter", filter);

      args.push("--logger:trx", `--results-directory:${resultsDir}`);

      const result = await exec("dotnet", args, { cwd, timeout: 120_000 });

      // Find and parse the TRX file
      let trxContent: string | undefined;
      try {
        const files = findTrxFiles(resultsDir);
        if (files.length > 0) {
          trxContent = readFileSync(files[0]!, "utf8");
        }
      } catch {
        // TRX dir may not exist if dotnet test failed before producing output
      } finally {
        // Clean up temp directory
        try {
          rmSync(resultsDir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup
        }
      }

      if (!trxContent) {
        const output = `${result.stdout}\n${result.stderr}`.trim();
        return err(output.slice(0, 500) || "No test output received", {
          exitCode: result.exitCode,
          passed: 0,
          failed: 0,
          skipped: 0,
          total: 0,
          failures: [],
          summary: "No TRX output produced",
        });
      }

      const { results, passed, failed, skipped, total } =
        parseTrxResults(trxContent);

      const parts: string[] = [];
      if (passed > 0) parts.push(`${passed} passed`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      const summary = parts.join(", ") || "0 tests";

      return ok({
        exitCode: result.exitCode,
        passed,
        failed,
        skipped,
        total,
        failures: results,
        summary,
      });
    },
  );
}

/** Find .trx files in a directory, sorted by modification time (newest first). */
function findTrxFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".trx"))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Auto-detect a .sln file in the given directory.
 * Returns the filename if exactly one .sln is found, undefined otherwise.
 */
function detectSolution(cwd: string): string | undefined {
  try {
    const entries = readdirSync(cwd);
    const slnFiles = entries.filter((e) => e.endsWith(".sln"));
    return slnFiles.length === 1 ? slnFiles[0] : undefined;
  } catch {
    return undefined;
  }
}
