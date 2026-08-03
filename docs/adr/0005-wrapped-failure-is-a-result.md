# ADR-0005: A wrapped command that fails is a result, not an error

- **Status:** Accepted
- **Date:** 2026-06-10 (established earlier in `exec`, made explicit by liquibase-tools)

## Context

Two different things look like failure: a command that ran and reported a problem (lint
found errors, validation failed, tests failed), and a command that could not run at all
(binary missing, timeout, permission denied). Conflating them makes an agent treat a
failing test suite as a broken tool and retry it.

## Decision

`exec()` always resolves and never rejects. Failure arrives as `exitCode !== 0`, plus
`errorCode`, `signal`, and `timedOut`. Callers inspect the result; no try/catch.

A command that ran gets `ok(...)` with the failure in the payload — `valid: false`,
`errorCount`, the diagnostics. Only an *unrunnable* command gets `err()`, classified by
`classifyError` into a `ToolError` kind (missing_binary → timeout → stderr scan →
command_failed, in that precedence) with a suggestion.

Per-tool the boundary depends on the CLI's own exit conventions: `liquibase_validate` uses
`exitCode ≠ 0 && errorCount === 0`, while `liquibase_status` / `liquibase_update_sql` use a
bare `exitCode ≠ 0` because they exit 0 on success.

Tools never throw. `defineTool` converts an escaped throw into `err()` as a backstop, not
as the expected path.

`execJson()` narrows its result to `data | error`, which discards the very fields
`classifyError` reads. So it classifies before narrowing and returns the `ToolError` as
`detail`; callers pass it straight to `err()`'s third argument. Without that, every
JSON-speaking tool — all of Kubernetes, Helm, Terraform and ArgoCD — could only report an
unclassified string, and their wide events carried no `errorKind`.

## Consequences

- An agent can distinguish "your code has problems" from "I couldn't check your code".
- Pure parsers must never throw on malformed input — they return safe empty or partial
  results, so a weird CLI version degrades output instead of failing the call.
- Diagnostic tools capture sub-command failures in `evidence[]` and still return a partial
  answer rather than a hard error.
