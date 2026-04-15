/**
 * Run Tool
 *
 * Executes a shell command and returns structured output with smart
 * truncation. Keeps the last N lines of stdout (where errors typically
 * appear) so callers get exit code + error context without wading
 * through hundreds of progress lines.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { ok } from "#response";

/** Register the run tool on the MCP server. */
export function registerRunTools(server: McpServer) {
  server.registerTool(
    "run",
    {
      title: "Run a command",
      description:
        "Run a shell command and return structured output with smart truncation. Keeps the last N lines of output (where errors typically appear). Use for build, test, and lint commands where you need exit code and error details, not full verbose output.",
      inputSchema: {
        command: z.string().describe("The command to run (e.g. 'npm')"),
        args: z
          .array(z.string())
          .optional()
          .default([])
          .describe("Command arguments (e.g. ['test'])"),
        cwd: z.string().optional().describe("Working directory"),
        timeout: z.number().optional().default(30000).describe("Timeout in ms"),
        maxLines: z
          .number()
          .optional()
          .default(50)
          .describe("Max stdout lines to keep (last N). 0 = unlimited."),
      },
      outputSchema: {
        exitCode: z.number(),
        stdout: z.string(),
        stderr: z.string(),
        stdoutLines: z.number(),
        truncated: z.boolean(),
        elapsed: z
          .number()
          .describe("Wall-clock execution time in milliseconds"),
      },
    },
    async ({ command, args, cwd, timeout, maxLines }) => {
      const start = Date.now();
      const result = await exec(command, args, { cwd, timeout });

      const lines = result.stdout.split("\n");
      // Remove trailing empty line from split (stdout often ends with \n)
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

      const totalLines = lines.length;
      const limit = maxLines ?? 50;
      let truncated = false;
      let stdout: string;

      if (limit > 0 && totalLines > limit) {
        truncated = true;
        const kept = lines.slice(-limit);
        stdout = `... (${totalLines - limit} lines truncated) ...\n${kept.join("\n")}`;
      } else {
        stdout = lines.join("\n");
      }

      return ok({
        exitCode: result.exitCode,
        stdout,
        stderr: result.stderr,
        stdoutLines: totalLines,
        truncated,
        elapsed: Date.now() - start,
      });
    },
  );
}
