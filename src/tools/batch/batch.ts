/**
 * Batch Tool
 *
 * Runs multiple shell commands in parallel and returns all results
 * in a single response. Useful for gathering independent pieces of
 * information without multiple sequential tool calls.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { ok } from "#response";

/** Register the batch tool on the MCP server. */
export function registerBatchTools(server: McpServer) {
  server.registerTool(
    "batch",
    {
      title: "Run commands in parallel",
      description:
        "Run multiple shell commands in parallel and return all results. " +
        "Use when you need to gather independent pieces of information " +
        "in a single tool call instead of multiple sequential calls.",
      inputSchema: {
        commands: z.array(
          z.object({
            command: z.string(),
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

      const results = await Promise.all(
        commands.map(async (cmd) => {
          const result = await exec(cmd.command, cmd.args ?? [], {
            cwd: cmd.cwd,
            timeout: cmd.timeout ?? 30_000,
          });
          return {
            label: cmd.label ?? cmd.command,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
          };
        }),
      );

      return ok({ results, elapsed: Date.now() - start });
    },
  );
}
