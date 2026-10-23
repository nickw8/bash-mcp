/**
 * Command Execution Layer
 *
 * Wraps Node.js child_process.spawn with consistent error handling,
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
 *
 * Cleanup: on POSIX each child leads its own process group, so a timeout, a
 * cancelled MCP request, or the server exiting kills the whole tree — the
 * `node` that `npm test` started, not only `npm`. A request's cancellation
 * reaches `exec` through `callSignal`, which `defineTool` sets per call, so no
 * tool has to thread a signal through.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { type ChildProcess, spawn } from "node:child_process";
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
  /** True when the caller's request was cancelled and the process killed. */
  cancelled?: boolean;
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
  /** Kill the process when this aborts. Defaults to the current call's signal. */
  signal?: AbortSignal;
}

/**
 * The AbortSignal of the MCP request being handled. `defineTool` runs each
 * handler inside `callSignal.run(extra.signal, …)`, and `exec` reads it, so a
 * `notifications/cancelled` kills the command that request started.
 */
export const callSignal = new AsyncLocalStorage<AbortSignal | undefined>();

const POSIX = process.platform !== "win32";
/** Grace between SIGTERM and SIGKILL for a child that ignores SIGTERM. */
const KILL_GRACE_MS = 2_000;
const live = new Set<ChildProcess>();

/** Signal the child's whole process group (POSIX), or just the child. */
function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (POSIX) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // Already gone, or the group is: nothing left to kill.
  }
}

function terminate(child: ChildProcess): void {
  killTree(child, "SIGTERM");
  setTimeout(() => killTree(child, "SIGKILL"), KILL_GRACE_MS).unref();
}

// A detached child outlives the server unless something kills it. "exit" is
// synchronous, so SIGKILL: there is no later moment to escalate from SIGTERM.
process.once("exit", () => {
  for (const child of live) killTree(child, "SIGKILL");
});

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
 * Uses spawn without a shell to avoid shell injection — the command and
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
  const signal = options.signal ?? callSignal.getStore();
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  return new Promise((resolve) => {
    let timedOut = false;
    let cancelled = false;
    let errorCode: string | undefined;
    let settled = false;
    // spawn, not execFile: execFile passes only some options on to spawn and
    // drops `detached`, so its child never leads a group killTree can reach.
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : undefined,
      detached: POSIX,
    });
    live.add(child);

    const out = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    let bytes = 0;
    for (const name of ["stdout", "stderr"] as const) {
      child[name]?.on("data", (chunk: Buffer) => {
        if (errorCode) return;
        bytes += chunk.length;
        if (bytes > maxBuffer) {
          // Same code and behaviour as execFile's maxBuffer: stop and kill.
          errorCode = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
          out[name].push(chunk.subarray(0, chunk.length - (bytes - maxBuffer)));
          terminate(child);
          return;
        }
        out[name].push(chunk);
      });
    }

    const finish = (code: number | null, sig: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      live.delete(child);
      const failed = code !== 0 || errorCode !== undefined;
      resolve({
        stdout: Buffer.concat(out.stdout).toString(),
        stderr: Buffer.concat(out.stderr).toString(),
        // A signal kill or a spawn failure has no exit code; report 1.
        exitCode: failed ? code || 1 : 0,
        // A string code (e.g. "ENOENT") means the process never ran normally,
        // which lets classifyError() spot a missing binary.
        errorCode,
        signal: sig ?? undefined,
        timedOut: timedOut || undefined,
        cancelled: cancelled || undefined,
      });
    };
    child.on("error", (e: NodeJS.ErrnoException) => {
      errorCode ??= e.code;
      finish(null, null);
    });
    child.on("close", finish);

    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, options.timeout ?? TIMEOUT.DEFAULT);
    const onAbort = () => {
      cancelled = true;
      terminate(child);
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    if (options.stdin !== undefined) {
      // A filter can exit before reading its whole input (a bad jq program, a
      // missing binary); the resulting EPIPE is the child's failure to report,
      // not ours, so swallow it and let the close handler resolve normally.
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
