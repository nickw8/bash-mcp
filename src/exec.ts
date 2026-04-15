/**
 * Command Execution Layer
 *
 * Wraps Node.js child_process.execFile with consistent error handling,
 * timeouts, and buffer limits. All tool modules use these functions
 * instead of spawning processes directly.
 *
 * Two execution modes:
 *   - exec()     — returns raw stdout/stderr/exitCode
 *   - execJson() — parses stdout as JSON, returns typed data or error
 */

import { execFile } from "node:child_process";

/** Raw output from a command execution. */
export interface ExecResult {
  /** Standard output from the command. */
  stdout: string;
  /** Standard error from the command. */
  stderr: string;
  /** Process exit code (0 = success). */
  exitCode: number;
}

/** Options for controlling command execution. */
export interface ExecOptions {
  /** Working directory for the child process. */
  cwd?: string;
  /** Additional environment variables (merged with process.env). */
  env?: Record<string, string>;
  /** Maximum execution time in milliseconds (default: 30s). */
  timeout?: number;
  /** Maximum stdout/stderr buffer size in bytes (default: 10 MB). */
  maxBuffer?: number;
}

/** Default timeout for all commands (30 seconds). */
const DEFAULT_TIMEOUT = 30_000;

/** Default max buffer for stdout/stderr (10 MB). */
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Execute a command and return raw output.
 *
 * Uses execFile (not exec) to avoid shell injection — the command and
 * arguments are passed directly to the OS without shell interpolation.
 * Always resolves (never rejects) so callers can inspect exitCode
 * without try/catch.
 *
 * @param command - The binary to execute (e.g. "kubectl", "git")
 * @param args - Array of arguments passed to the command
 * @param options - Execution options (cwd, env, timeout, maxBuffer)
 * @returns Resolved result with stdout, stderr, and exitCode
 */
export function exec(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : undefined,
        timeout: options.timeout ?? DEFAULT_TIMEOUT,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          exitCode:
            error && "code" in error ? Number(error.code) || 1 : 0,
        });
      },
    );
  });
}

/**
 * Execute a command and parse stdout as JSON.
 *
 * Convenience wrapper around exec() for tools that support JSON output
 * (e.g. `kubectl get -o json`, `helm list -o json`). Returns the parsed
 * data on success, or an error message on failure or parse error.
 *
 * @param command - The binary to execute
 * @param args - Array of arguments passed to the command
 * @param options - Execution options (cwd, env, timeout, maxBuffer)
 * @returns Parsed JSON data, or error string with exitCode
 */
export function execJson<T>(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<{ data: T | null; error: string | null; exitCode: number }> {
  return exec(command, args, options).then((result) => {
    if (result.exitCode !== 0) {
      return { data: null, error: result.stderr || result.stdout, exitCode: result.exitCode };
    }
    try {
      return { data: JSON.parse(result.stdout) as T, error: null, exitCode: 0 };
    } catch {
      return { data: null, error: `Failed to parse JSON: ${result.stdout.slice(0, 200)}`, exitCode: result.exitCode };
    }
  });
}
