/**
 * Run-Sequence Tool
 *
 * Runs an ordered list of labeled commands sequentially, short-circuiting on
 * the first failure (unless `stopOnError` is false). Use for dependent steps
 * where each command relies on the previous one — the structured replacement
 * for `cmd1 && cmd2 && cmd3` chained through a single `run`. Unlike `batch`
 * (parallel, order-independent), `run_seq` preserves order and stops early.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok } from "#response";
import { runStep } from "#step";
import { defineTool } from "#tool";

/** Register the run_seq tool on the MCP server. */
export function registerRunSeqTools(server: McpServer) {
  defineTool(
    server,
    "run_seq",
    {
      title: "Run commands in sequence",
      description:
        "Run an ordered list of labeled commands one after another, stopping at " +
        "the first failure by default. Use for dependent steps (e.g. build then " +
        "test then package) where order matters and a later step is pointless if " +
        "an earlier one fails. Unlike batch (parallel), run_seq is sequential and " +
        "short-circuits; set stopOnError=false to run every step regardless.",
      equivalentCommands: ["cmd1 && cmd2 && cmd3"],
      required: ["steps"],
      inputSchema: {
        steps: z
          .array(
            z.object({
              command: z
                .string()
                .describe(
                  "The binary to execute — NOT a shell string (e.g. 'npm', 'sh'). For pipes/redirects in a step, use command='sh' with args=['-c', '<script>'].",
                ),
              args: z
                .array(z.string())
                .optional()
                .default([])
                .describe(
                  "Arguments passed directly to the binary (e.g. ['test']). With command='sh', use ['-c', '<shell script>'].",
                ),
              cwd: z.string().optional().describe("Working directory"),
              label: z
                .string()
                .optional()
                .describe(
                  "Label for this step in the results (defaults to the command name)",
                ),
              timeout: z
                .number()
                .optional()
                .default(30000)
                .describe("Timeout in ms"),
            }),
          )
          .optional()
          .describe("Ordered steps to run sequentially"),
        stopOnError: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Stop at the first step with a non-zero exit code (default true).",
          ),
        maxLines: z
          .number()
          .optional()
          .default(50)
          .describe("Max stdout/stderr lines to keep per step. 0 = unlimited."),
      },
      outputSchema: {
        steps: z.array(
          z.object({
            label: z.string(),
            exitCode: z.number(),
            stdout: z.string(),
            stderr: z.string(),
            elapsed: z
              .number()
              .describe("Wall-clock execution time in milliseconds"),
          }),
        ),
        exitCode: z
          .number()
          .describe("0 if every step succeeded, else the first failure's code"),
        failedAt: z
          .number()
          .nullable()
          .describe("Index of the first failing step, or null if all passed"),
        elapsed: z.number().describe("Total wall-clock time in milliseconds"),
      },
    },
    // Empty fallback for a `required` argument — see the note in batch.ts.
    async ({ steps = [], stopOnError, maxLines }) => {
      const start = Date.now();

      // runStep is the shared gate -> exec -> shape pipeline (see #exec); the
      // BASH_MCP_MODE check lives there so it can't drift from run/batch. We
      // loop sequentially (not Promise.all) so a step can depend on the prior
      // one and we can short-circuit on the first failure.
      const results = [];
      let failedAt: number | null = null;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step) continue;
        const r = await runStep(
          {
            command: step.command,
            args: step.args ?? [],
            cwd: step.cwd,
            timeout: step.timeout ?? 30_000,
            label: step.label,
          },
          { maxLines },
        );
        results.push({
          label: r.label,
          exitCode: r.exitCode,
          stdout: r.stdout,
          stderr: r.stderr,
          elapsed: r.elapsed,
        });
        if (r.exitCode !== 0) {
          if (failedAt === null) failedAt = i;
          if (stopOnError) break;
        }
      }

      const exitCode =
        failedAt === null ? 0 : (results[failedAt]?.exitCode ?? 1);

      return ok({
        steps: results,
        exitCode,
        failedAt,
        elapsed: Date.now() - start,
      });
    },
  );
}
