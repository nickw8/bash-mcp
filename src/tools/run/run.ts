/**
 * Run Tool
 *
 * Executes a single command (a binary plus an args array, via execFile — no
 * shell) and returns structured output with smart truncation. Keeps the last
 * N lines of stdout (where errors typically appear) so callers get exit code +
 * error context without wading through hundreds of progress lines. For a real
 * shell pipeline, the caller passes command='sh', args=['-c', '<script>'].
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, shapeOutput } from "#exec";
import { err, ok } from "#response";
import { checkCommandAllowed } from "#safety";
import { defineTool } from "#tool";

/** Register the run tool on the MCP server. */
export function registerRunTools(server: McpServer) {
  defineTool(
    server,
    "run",
    {
      title: "Run a command",
      description:
        "Run a single command — a binary plus an args array, executed directly without a shell (so no pipes, redirects, or ';'/'&&' in the string) — and return structured output with smart truncation. Pass the binary as `command` and its arguments as `args` (e.g. command='npm', args=['test']); for a real shell pipeline run the shell yourself: command='sh', args=['-c', 'a | b > c']. Keeps the last N lines of output by default (where errors typically appear), or the first N with mode='head'. Use for build, test, and lint commands where you need exit code and error details, not full verbose output.",
      equivalentCommands: ["<command> | tail -n N", "<command> | head -n N"],
      inputSchema: {
        command: z
          .string()
          .describe(
            "The binary to execute — NOT a shell string (e.g. 'npm', 'git', 'sh'). For pipes/redirects, use command='sh' and put the script in args.",
          ),
        args: z
          .array(z.string())
          .optional()
          .default([])
          .describe(
            "Arguments passed directly to the binary (e.g. ['test']). With command='sh', use ['-c', '<shell script>'].",
          ),
        cwd: z.string().optional().describe("Working directory"),
        timeout: z.number().optional().default(30000).describe("Timeout in ms"),
        maxLines: z
          .number()
          .optional()
          .default(50)
          .describe("Max stdout/stderr lines to keep. 0 = unlimited."),
        mode: z
          .enum(["tail", "head"])
          .optional()
          .default("tail")
          .describe(
            "Keep the last N lines (tail, default) or the first N (head).",
          ),
        maxBytes: z
          .number()
          .optional()
          .describe("Optional cap on stdout/stderr byte length (UTF-8)."),
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
    async ({ command, args, cwd, timeout, maxLines, mode, maxBytes }) => {
      const start = Date.now();

      // Safety profile (default readOnly): block mutating commands unless
      // BASH_MCP_MODE is set to off/dangerous. Unset → readOnly (writes gated).
      const gate = checkCommandAllowed(command, args);
      if (!gate.allowed) {
        const reason = gate.reason ?? "blocked by BASH_MCP_MODE";
        return err(
          reason,
          {
            exitCode: 126,
            stdout: "",
            stderr: reason,
            stdoutLines: 0,
            truncated: false,
            elapsed: 0,
          },
          { kind: "permission_denied", message: reason, command },
        );
      }

      const result = await exec(command, args, { cwd, timeout });

      // shapeOutput is the shared tail/head/byte trimmer (see #exec); stderr is
      // trimmed with the same policy so a noisy failure can't blow the budget.
      const shape = { mode, maxLines, maxBytes };
      const stdout = shapeOutput(result.stdout, shape);
      const stderr = shapeOutput(result.stderr, shape);

      return ok({
        exitCode: result.exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutLines: stdout.totalLines,
        truncated: stdout.truncated || stderr.truncated,
        elapsed: Date.now() - start,
      });
    },
  );
}
