/**
 * Command Execution Layer
 *
 * Wraps Node.js child_process.execFile with consistent error handling,
 * timeouts, and buffer limits. All tool modules use these functions
 * instead of spawning processes directly. Spawning only: Shaping lives in
 * #shape, the mode-gated step runner in #step, BSD/GNU flags in #platform.
 *
 * Two execution modes:
 *   - exec()     — returns raw stdout/stderr/exitCode
 *   - execJson() — parses stdout as JSON, returns typed data, error and a
 *                  classified ToolError
 *
 * Nothing here builds a shell string. A filter that needs a document on stdin
 * gets it through `options.stdin`, written down the pipe.
 */

import { execFile } from "node:child_process";
import { classifyError, type ToolError } from "#error";

/** Raw output from a command execution. */
export interface ExecResult {
  /** Standard output from the command. */
  stdout: string;
  /** Standard error from the command. */
  stderr: string;
  /** Process exit code (0 = success). */
  exitCode: number;
  /**
   * Raw spawn error code when the process could not run as a normal exit —
   * e.g. "ENOENT" for a missing binary. Undefined on success or a clean
   * non-zero exit. Lets classifyError() distinguish missing-binary failures.
   */
  errorCode?: string;
  /** Signal that terminated the process (e.g. "SIGTERM"), if any. */
  signal?: string;
  /** True when the process was killed for exceeding its timeout. */
  timedOut?: boolean;
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
  /**
   * Text written to the child's stdin, then closed. Goes down the pipe as
   * bytes — it is never part of the command line, so it is not subject to
   * ARG_MAX and no shell ever sees it.
   */
  stdin?: string;
}

/** Default max buffer for stdout/stderr (10 MB). */
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

// ── Timeout Constants ──

export const TIMEOUT = {
  DEFAULT: 30_000,
  INFRA: 15_000,
  BUILD: 120_000,
  TYPECHECK: 60_000,
} as const;

/**
 * Execute a command and return raw output.
 *
 * Uses execFile (not exec) to avoid shell injection — the command and
 * arguments are passed directly to the OS without shell interpolation.
 * Always resolves (never rejects) so callers can inspect exitCode
 * without try/catch.
 *
 * Pass `options.stdin` to feed the process input; it is written to the pipe
 * and the stream closed, so a filter like `jq` or `yq` gets its document
 * without a shell and without an ARG_MAX ceiling.
 *
 * @param command - The binary to execute (e.g. "kubectl", "git")
 * @param args - Array of arguments passed to the command
 * @param options - Execution options (cwd, env, timeout, maxBuffer, stdin)
 * @returns Resolved result with stdout, stderr, and exitCode
 */
export function exec(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : undefined,
        timeout: options.timeout ?? TIMEOUT.DEFAULT,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        const e = error as
          | (NodeJS.ErrnoException & { killed?: boolean; signal?: string })
          | null;
        // execFile sets killed:true when it terminates the child for either a
        // timeout or a maxBuffer overflow; only the former is a real timeout.
        const timedOut =
          e?.killed === true && e.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          exitCode: error && "code" in error ? Number(error.code) || 1 : 0,
          // error.code is a numeric exit code on a normal non-zero exit, but a
          // string (e.g. "ENOENT") when the process never ran. Surface only the
          // string form so callers can detect missing binaries.
          errorCode: typeof e?.code === "string" ? e.code : undefined,
          signal: e?.signal ?? undefined,
          timedOut: timedOut || undefined,
        });
      },
    );

    if (options.stdin !== undefined) {
      // A filter can exit before reading its whole input (a bad jq program, a
      // missing binary); the resulting EPIPE is the child's failure to report,
      // not ours, so swallow it and let the callback above resolve normally.
      child.stdin?.on("error", () => {});
      child.stdin?.end(options.stdin);
    }
  });
}

/** What {@link execJson} resolves with. */
export interface ExecJsonResult<T> {
  /** Parsed JSON, or null on any failure. */
  data: T | null;
  /** Human-readable failure message, or null on success. */
  error: string | null;
  exitCode: number;
  /**
   * The failure classified into the ADR-0005 taxonomy (missing_binary,
   * timeout, permission_denied, …), set whenever `error` is non-null. Pass it
   * as `err`'s third argument so the tool reports a kind and `defineTool`
   * records `errorKind` on the wide event — the raw fields it is derived from
   * (`errorCode`, `timedOut`, `stderr`) are otherwise lost here.
   */
  detail?: ToolError;
}

/**
 * Execute a command and parse stdout as JSON.
 *
 * Convenience wrapper around exec() for tools that support JSON output
 * (e.g. `kubectl get -o json`, `helm list -o json`). Returns the parsed
 * data on success, or an error message plus a classified `detail` on failure.
 *
 * @param command - The binary to execute
 * @param args - Array of arguments passed to the command
 * @param options - Execution options (cwd, env, timeout, maxBuffer)
 * @returns Parsed JSON data, or error string with exitCode and detail
 */
export function execJson<T>(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecJsonResult<T>> {
  return exec(command, args, options).then((result) => {
    if (result.exitCode !== 0) {
      return {
        data: null,
        error: result.stderr || result.stdout,
        exitCode: result.exitCode,
        detail: classifyError(result, command),
      };
    }
    try {
      return { data: JSON.parse(result.stdout) as T, error: null, exitCode: 0 };
    } catch {
      const error = `Failed to parse JSON: ${result.stdout.slice(0, 200)}`;
      return {
        data: null,
        error,
        exitCode: result.exitCode,
        // The command ran and exited 0; what came back was not JSON. That is a
        // parse failure, not anything classifyError can read off the process.
        detail: { kind: "parse_failed", message: error, command },
      };
    }
  });
}
