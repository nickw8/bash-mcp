# ADR-0004: One wide event per call, on stderr, with no dependencies

- **Status:** Accepted
- **Date:** 2026-05-31 (agent-ops-roadmap)

## Context

The server needed observability, but stdout is the MCP protocol channel — anything written
there corrupts the session. A logging library would also add a dependency to a package
whose selling point is being small enough to bundle.

## Decision

`src/logger.ts` is a zero-dependency structured logger writing JSON lines to **stderr**.
Each tool call emits exactly one *wide event* — a single line carrying every field about
that call (tool, outcome, duration, error kind) rather than several narrow log lines.

`resolveLevel(BASH_MCP_LOG)`: `error` (default, failed calls only), `info` (adds
successes), `off`/`silent`. Lifecycle events (server start, fatal) are always emitted and
share the static context. Level, sink, and context are injectable for tests.

`run`/`batch` arguments are redacted — metadata only, never the argument values.

## Consequences

- Debugging a call means finding one line, not correlating several.
- Nothing is ever written to stdout outside the MCP protocol. `--doctor` prints a report
  to stdout only because it exits before any session starts.
- Argument redaction means a wide event cannot leak a secret passed to `run`, at the cost
  of not being able to reconstruct the exact command from logs alone.
