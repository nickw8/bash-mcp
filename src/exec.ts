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
import { checkCommandAllowed } from "#safety";
import { shellEscape } from "#shell";

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
}

/** Default max buffer for stdout/stderr (10 MB). */
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

export const IS_MACOS = process.platform === "darwin";

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
      return {
        data: null,
        error: result.stderr || result.stdout,
        exitCode: result.exitCode,
      };
    }
    try {
      return { data: JSON.parse(result.stdout) as T, error: null, exitCode: 0 };
    } catch {
      return {
        data: null,
        error: `Failed to parse JSON: ${result.stdout.slice(0, 200)}`,
        exitCode: result.exitCode,
      };
    }
  });
}

export function execWithStdin(
  command: string,
  args: string[],
  stdin: string,
  options: ExecOptions = {},
): Promise<ExecResult> {
  const escapedArgs = args.map(shellEscape).join(" ");
  return exec(
    "sh",
    ["-c", `echo ${shellEscape(stdin)} | ${command} ${escapedArgs}`],
    options,
  );
}

// ── Output Shaping ──

/** Which end of the output to keep when trimming. */
export type ShapeMode = "tail" | "head";

/** Controls for {@link shapeOutput}. */
export interface ShapeOptions {
  /** Keep the last N lines (tail, default) or the first N (head). */
  mode?: ShapeMode;
  /** Max lines to keep; `0`/undefined = unlimited. */
  maxLines?: number;
  /** Optional cap on the resulting byte length (UTF-8). */
  maxBytes?: number;
}

/** Result of {@link shapeOutput}: trimmed text plus pre-trim line count. */
export interface ShapedOutput {
  text: string;
  /** Line count of the original output (before any trimming). */
  totalLines: number;
  /** True when lines and/or bytes were dropped. */
  truncated: boolean;
}

/**
 * Trim command output to a line and/or byte budget. Shared by `run`, `run_seq`
 * and `bash_test` so the tail/head logic lives in one place. A trailing empty
 * line from the final newline is always dropped before counting (output usually
 * ends with `\n`). When lines are dropped a `... (N lines truncated) ...` marker
 * is inserted on the trimmed side.
 */
export function shapeOutput(
  raw: string,
  opts: ShapeOptions = {},
): ShapedOutput {
  const { mode = "tail", maxLines, maxBytes } = opts;

  const lines = raw.split("\n");
  // Drop the trailing empty element from a final newline before counting.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const totalLines = lines.length;

  let truncated = false;
  let kept = lines;
  if (maxLines !== undefined && maxLines > 0 && totalLines > maxLines) {
    truncated = true;
    kept = mode === "head" ? lines.slice(0, maxLines) : lines.slice(-maxLines);
  }

  const omitted = totalLines - kept.length;
  const marker = `... (${omitted} lines truncated) ...`;
  let text = kept.join("\n");
  if (omitted > 0) {
    text = mode === "head" ? `${text}\n${marker}` : `${marker}\n${text}`;
  }

  // Byte cap applies after line shaping, trimming from the same end.
  if (maxBytes !== undefined && maxBytes > 0) {
    const buf = Buffer.from(text, "utf8");
    if (buf.byteLength > maxBytes) {
      truncated = true;
      const sliced =
        mode === "head"
          ? buf.subarray(0, maxBytes)
          : buf.subarray(buf.byteLength - maxBytes);
      text = sliced.toString("utf8");
    }
  }

  return { text, totalLines, truncated };
}

// ── Guarded Step Runner ──

/** A single command to run through {@link runStep}. */
export interface RunStepInput {
  command: string;
  args?: string[];
  cwd?: string;
  timeout?: number;
  /** Label for this step in the results (defaults to the command name). */
  label?: string;
}

/** Result of running one {@link runStep} (shape shared by batch/run_seq). */
export interface RunStepResult {
  label: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Wall-clock execution time in milliseconds (0 when blocked). */
  elapsed: number;
  /** True when blocked by BASH_MCP_MODE before executing. */
  blocked: boolean;
}

/**
 * Run one command through the full guarded pipeline:
 * `checkCommandAllowed` → `exec` → `shapeOutput` → elapsed timing. This is the
 * single chokepoint for BASH_MCP_MODE gating across the multi-command runners
 * (`batch`, `run_seq`) so the safety check can't drift between copies. A blocked
 * command resolves with `exitCode: 126`, `blocked: true`, and the reason in
 * `stderr` — exactly as `run`/`batch` did inline.
 */
export async function runStep(
  step: RunStepInput,
  shape: ShapeOptions = {},
): Promise<RunStepResult> {
  const args = step.args ?? [];
  const label = step.label ?? step.command;

  const gate = checkCommandAllowed(step.command, args);
  if (!gate.allowed) {
    return {
      label,
      exitCode: 126,
      stdout: "",
      stderr: gate.reason ?? "blocked by BASH_MCP_MODE",
      elapsed: 0,
      blocked: true,
    };
  }

  const start = Date.now();
  const result = await exec(step.command, args, {
    cwd: step.cwd,
    timeout: step.timeout,
  });

  return {
    label,
    exitCode: result.exitCode,
    stdout: shapeOutput(result.stdout, shape).text,
    stderr: shapeOutput(result.stderr, shape).text,
    elapsed: Date.now() - start,
    blocked: false,
  };
}
