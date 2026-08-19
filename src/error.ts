/**
 * Structured Error Taxonomy
 *
 * Tools surface failures as a bare string today (`err(message, structured)`),
 * which gives an agent no machine-readable way to decide how to recover.
 * `classifyError` maps an ExecResult + command into a `ToolError` — a
 * discriminated union over a fixed set of recovery-relevant kinds, each with a
 * human-actionable `suggestion`.
 *
 * Pattern: discriminated union + exhaustive switch (`/arch:node`). The
 * `as const` kind list drives both the `ToolErrorKind` type and a runtime
 * membership check; `suggestionFor` has a `never` arm so adding a kind without
 * handling it is a compile error.
 */

import type { ExecResult } from "#exec";

/** All recovery-relevant failure kinds. */
export const TOOL_ERROR_KINDS = [
  "missing_binary",
  "timeout",
  "permission_denied",
  "not_authenticated",
  "not_found",
  "invalid_input",
  "command_failed",
  "parse_failed",
] as const;

export type ToolErrorKind = (typeof TOOL_ERROR_KINDS)[number];

/** Machine-readable error attached to a tool's structuredContent on failure. */
export interface ToolError {
  /** Recovery-relevant classification. */
  kind: ToolErrorKind;
  /** Human-readable failure message (usually the command's stderr). */
  message: string;
  /** The command that failed (binary or subcommand), for context. */
  command?: string;
  /** Actionable next step for the kind (e.g. "Install kubectl"). */
  suggestion?: string;
  /** Process exit code, when known. */
  exitCode?: number;
}

/** Subset of ExecResult that classification needs. */
type Classifiable = Pick<
  ExecResult,
  "stderr" | "exitCode" | "errorCode" | "timedOut"
>;

/**
 * A short, actionable suggestion per error kind. Exhaustive over ToolErrorKind.
 *
 * `errorCode` refines the generic advice where the OS already said something
 * more specific than the kind can carry — the argument list being too long is
 * `invalid_input`, but "check the arguments" is the wrong fix for it.
 */
function suggestionFor(
  kind: ToolErrorKind,
  command: string,
  errorCode?: string,
): string | undefined {
  if (errorCode === "E2BIG") {
    return "The argument list exceeded the OS limit. Pass the payload on stdin, or write it to a file and pass the path.";
  }
  switch (kind) {
    case "missing_binary":
      return `Install '${command}' or ensure it is on PATH.`;
    case "timeout":
      return "Increase the timeout or narrow the command's scope.";
    case "not_authenticated":
      return `Authenticate the CLI (e.g. log in) before retrying '${command}'.`;
    case "permission_denied":
      return "Check credentials/RBAC or run with sufficient permissions.";
    case "not_found":
      return "Verify the resource name, namespace, or path exists.";
    case "invalid_input":
      return "Check the command arguments and input format.";
    case "command_failed":
      return undefined;
    case "parse_failed":
      return "The command output could not be parsed as expected.";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** Map stderr text to a kind. Order matters: most specific first. */
function kindFromStderr(stderr: string): ToolErrorKind {
  const s = stderr.toLowerCase();
  if (
    s.includes("unauthorized") ||
    s.includes("must be logged in") ||
    s.includes("not logged in") ||
    s.includes("authentication required") ||
    s.includes("please log in")
  ) {
    return "not_authenticated";
  }
  if (
    s.includes("forbidden") ||
    s.includes("permission denied") ||
    s.includes("access denied")
  ) {
    return "permission_denied";
  }
  if (
    s.includes("not found") ||
    s.includes("notfound") ||
    s.includes("no such")
  ) {
    return "not_found";
  }
  return "command_failed";
}

/**
 * Classify an ExecResult into a ToolError.
 *
 * Precedence: a process that never ran (ENOENT) or was killed for timeout is
 * classified before inspecting stderr, since those signals are unambiguous.
 */
export function classifyError(
  result: Classifiable,
  command: string,
): ToolError {
  let kind: ToolErrorKind;
  if (result.errorCode === "ENOENT") {
    kind = "missing_binary";
  } else if (result.errorCode === "E2BIG") {
    // The command never ran: the caller built an argv the OS refused. That is
    // the caller's input, not a command failure, and the retry is a different
    // shape of call rather than the same one again.
    kind = "invalid_input";
  } else if (result.timedOut) {
    kind = "timeout";
  } else {
    kind = kindFromStderr(result.stderr);
  }

  return {
    kind,
    message: result.stderr.trim() || `Command '${command}' failed`,
    command,
    suggestion: suggestionFor(kind, command, result.errorCode),
    exitCode: result.exitCode,
  };
}
