/**
 * Batch Tool
 *
 * Runs multiple commands (each a binary plus an args array, via execFile — no
 * shell) in parallel and returns all results in a single response. Useful for
 * gathering independent pieces of information without multiple sequential tool
 * calls. For a pipeline in a command, use command='sh', args=['-c', '<script>'].
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runStep } from "#exec";
import { ok } from "#response";
import { defineTool } from "#tool";

/** Register the batch tool on the MCP server. */
export function registerBatchTools(server: McpServer) {
  defineTool(
    server,
    "batch",
    {
      title: "Run commands in parallel",
      description:
        "Run multiple commands in parallel and return all results. Each command " +
        "is a binary plus an args array, executed without a shell (for a pipeline " +
        "use command='sh', args=['-c', '...']). Use when you need to gather " +
        "independent pieces of information in a single tool call instead of " +
        "multiple sequential calls.",
      inputSchema: {
        commands: z.array(
          z.object({
            command: z
              .string()
              .describe(
                "The binary to execute — NOT a shell string (e.g. 'git', 'sh'). For pipes/redirects, use command='sh' with args=['-c', '<script>'].",
              ),
            args: z.array(z.string()).optional().default([]),
            cwd: z.string().optional(),
            label: z
              .string()
              .optional()
              .describe(
                "Label for this command in the results (defaults to the command name)",
              ),
            timeout: z.number().optional().default(30000),
          }),
        ),
      },
      outputSchema: {
        results: z.array(
          z.object({
            label: z.string(),
            exitCode: z.number(),
            stdout: z.string(),
            stderr: z.string(),
          }),
        ),
        elapsed: z.number(),
      },
    },
    async ({ commands }) => {
      const start = Date.now();

      // runStep is the shared gate -> exec -> shape pipeline; BASH_MCP_MODE
      // gating lives there so it can't drift from run/run_seq. batch keeps its
      // parallel Promise.all semantics and its {label,exitCode,stdout,stderr}
      // result shape (no per-step elapsed).
      const stepResults = await Promise.all(
        commands.map((cmd) =>
          runStep({
            command: cmd.command,
            args: cmd.args ?? [],
            cwd: cmd.cwd,
            timeout: cmd.timeout ?? 30_000,
            label: cmd.label,
          }),
        ),
      );

      const results = stepResults.map(
        ({ label, exitCode, stdout, stderr }) => ({
          label,
          exitCode,
          stdout,
          stderr,
        }),
      );

      return ok({ results, elapsed: Date.now() - start });
    },
  );
}
