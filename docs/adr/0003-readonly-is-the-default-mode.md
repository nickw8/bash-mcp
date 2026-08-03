# ADR-0003: `BASH_MCP_MODE` defaults to `readOnly`

- **Status:** Accepted
- **Date:** 2026-05-31 (safe-defaults-and-packaging)
- **Breaking:** yes — an unset environment now blocks mutating `run`/`batch` commands

## Context

`run` and `batch` execute arbitrary binaries. The original default was `off`: with no
environment variable set, an agent could run a mutating command with no gate. The people
most likely to have nothing configured are new users who have not yet thought about what
the server is allowed to do.

## Decision

`resolveMode()` returns `readOnly` for unset and for any unrecognised value. Mutating
commands — classified by a const rule table in `src/safety.ts` — are blocked unless the
operator explicitly sets `off` or `dangerous`. `confirmWrites` is the middle setting.
`checkCommandAllowed` is the single gate: `run_seq` and `batch` reach it through `runStep`
(`src/step.ts`), `run` calls it directly, so the three cannot diverge on what is blocked.

## Consequences

- Safe default for anyone who installs and runs without reading the docs; an unrecognised
  typo in the variable fails closed rather than open.
- Trusted local use needs `BASH_MCP_MODE=off` set deliberately.
- Tests must neutralise the developer's own shell: run them with
  `env -u BASH_MCP_MODE npx vitest run` if you have `BASH_MCP_MODE=off` exported, or
  `safety.test.ts` passes for the wrong reason.
- The block message names the escape hatch (`Set BASH_MCP_MODE=off to allow writes`), so
  a blocked agent can tell the user what to change.
