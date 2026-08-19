# ADR-0014: An undeclared argument is refused, not dropped

- **Status:** Accepted
- **Date:** 2026-08-19 (payload-hardening)
- **Relates to:** [ADR-0001](0001-definetool-wraps-every-registration.md),
  [ADR-0013](0013-definetool-owns-required-arg-validation.md)

## Context

`registerTool` accepts a Zod raw shape and builds a `z.object()` from it. A plain
`z.object()` is in **strip** mode: a key the shape does not declare is deleted from the
arguments and the handler runs as if it were never sent.

Two calls from a real transcript
(`.claude/handoff/bash-mcp-parse-error-round-2.md`, session `f1450306`):

```jsonc
find_files      { "pattern": "*.md", "path": "…/skills", "nameContains": "plan", "maxResults": "20" }
git_diff_content{ "repoPath": "…/pfp-EQ-5217", "commit": "414110f7", "nameOnly": "true" }
```

`find_files` declares `name`, not `pattern`, `nameContains`, or `maxResults`; three of the
four keys were dropped, leaving a `find` with no name filter that returned every file under
the path. `git_diff_content` declares `cwd` and `ref`; **all three** keys were dropped, so it
diffed the default repo at the default ref. Both calls succeeded. Both answered a question
nobody asked, and the caller had no way to tell.

The advertised JSON Schema already said `additionalProperties: false`. The server did not
enforce what it published.

## Decision

`defineTool` wraps the tool's raw shape in `z.object(shape).strict()` before handing it to
`registerTool`. An undeclared argument is a hard rejection naming the offending keys:

```
MCP error -32602: … Unrecognized key(s) in object: 'repoPath', 'commit', 'nameOnly'
```

Tool files keep declaring a plain raw shape; nothing changes at the ~70 call sites, and the
published JSON Schema is byte-identical to what it was.

**This deliberately contradicts the direction of ADR-0013**, which moved required-argument
rejection *off* the SDK boundary because `-32602` carries no `structuredContent`, no
`error.kind`, and no wide event. That reasoning held there because Zod's message for a
missing field says nothing an agent can act on. It does not hold here: Zod names the exact
keys it refused, which is the entire remedy. Buying a readable result would mean
`.passthrough()`, which flips the advertised schema to `additionalProperties: true` — paying
in wrong advertising for a nicer error about a call that should not have been made.

## Considered options

- **`.passthrough()` plus an `invalid_input` result in the wrapper.** Rejected: matches
  ADR-0013's shape, but advertises `additionalProperties: true` to every client, which
  invites the guessing this ADR exists to stop.
- **Leave strip mode and fix the tools callers get wrong.** Rejected: symptom, not cause.
  Every tool is one plausible-but-wrong argument name away from the same silent wrong answer.
- **Coerce string-typed scalars (`"true"`, `"20"`).** Not adopted. Both observed cases were
  undeclared keys, so this fix already covers them; `z.coerce.boolean("false") === true` is a
  worse trap than the one being closed. Revisit if a *declared* field is seen mistyped.

## Consequences

- A call that used to succeed with garbage now fails loudly. That is the point, but it is a
  breaking change for any caller relying on extra keys being ignored.
- `find_files` gained `pattern` as an accepted alias for `name` in the same change: `rg` and
  `glob` both call it `pattern`, callers reach for that here, and under this ADR the guess is
  now a hard error rather than a silent one. One alias is cheaper than a recurring failed call.
- Guarded in `src/transport.stdio.test.ts`, over the shipped bundle — an in-process handler
  test cannot see schema validation, because the SDK does it before the handler runs.
