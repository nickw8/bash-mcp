/**
 * Wide-Event Logger
 *
 * One structured JSON event per tool call, written to **stderr** (stdout is
 * the MCP protocol channel). Follows the wide-event / canonical-log-line
 * pattern (`/logging-best-practices`): a single high-dimensionality event per
 * unit of work, emitted once, info/error only.
 *
 * Zero dependencies by design (see spec Open Questions): pino defaults to
 * stdout and its worker-thread transports fight the tsup single-file bundle,
 * while the need here is ~15 lines. The `Logger` interface is the seam so a
 * pino-backed impl could replace this without touching `defineTool`.
 *
 * Level is resolved from `BASH_MCP_LOG`:
 *   - unset / "error"        → emit only error-outcome events (default)
 *   - "info"                 → also emit success events
 *   - "off" / "silent"       → emit nothing
 */

/** Version reported in the static log context. Keep in sync with package.json. */
const VERSION = "0.1.0";

export type LogLevel = "off" | "error" | "info";

/** A single wide event describing one tool invocation. */
export interface WideEvent {
  tool: string;
  outcome: "success" | "error";
  duration_ms: number;
  /** Number of input args (count only — values are never logged). */
  argCount?: number;
  /** Working directory, when the tool takes one (paths are not secrets). */
  cwd?: string;
  /** ToolError kind on failure, when known. */
  errorKind?: string;
}

export interface Logger {
  logEvent(event: WideEvent): void;
}

/** Resolve a BASH_MCP_LOG value to a level; unknown/unset → "error". */
export function resolveLevel(raw: string | undefined): LogLevel {
  switch ((raw ?? "").toLowerCase()) {
    case "off":
    case "silent":
    case "0":
    case "false":
      return "off";
    case "info":
    case "1":
    case "true":
      return "info";
    default:
      return "error";
  }
}

interface LoggerOptions {
  /** Explicit level (defaults to resolveLevel(process.env.BASH_MCP_LOG)). */
  level?: LogLevel;
  /** Static high-cardinality context merged into every event. */
  context?: Record<string, unknown>;
  /** Sink (defaults to stderr). Injectable for tests. */
  write?: (line: string) => void;
}

/** Create a logger. Honors level gating and merges static context per event. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? resolveLevel(process.env.BASH_MCP_LOG);
  const context = options.context ?? {};
  const write = options.write ?? ((line: string) => process.stderr.write(line));

  return {
    logEvent(event: WideEvent) {
      if (level === "off") return;
      if (level === "error" && event.outcome !== "error") return;
      write(`${JSON.stringify({ ...context, ...event })}\n`);
    },
  };
}

/** Process-wide logger with static context (service, version, pid). */
export const logger = createLogger({
  context: { service: "bash-mcp", version: VERSION, pid: process.pid },
});
