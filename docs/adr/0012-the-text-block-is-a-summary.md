# ADR-0012: The text block is a one-line summary, not a second copy of the payload

- **Status:** Accepted
- **Date:** 2026-08-19 (payload-hardening)
- **Extends:** [ADR-0009](0009-structuredcontent-is-what-the-agent-reads.md)
- **Supersedes the remaining scope of:** [ADR-0006](0006-compact-text-block-via-oklist.md)

## Context

ADR-0009 established that a client which understands `structuredContent` renders the typed
payload and drops `content[0].text`. What it did not do is stop the server from *building*
that text. `ok()` serialized the whole payload into the text block, so every response
carried the same data twice — once as JSON, once as JSON re-escaped inside a JSON string.
A 4 KB payload shipped as ~9 KB of frame, and every quote in it became `\"`.

The trigger for revisiting this was a run of reported failures — agents seeing "tool call
was malformed and could not be parsed", sometimes needing the MCP connection restarted.
The duplicated, doubly-escaped text block was the obvious suspect.

## Decision

`content[0].text` is a **summary line**: one line describing the payload, never the payload.

`summarize(payload)` in `src/format.ts` renders scalars inline as `key=value`, arrays as
`key[n]`, nested objects as `key{n}`, and long (≥120 B) or multi-line strings as
`key=<bytes>B`. Low-signal values (`false`, `null`, `undefined`, `""`) are dropped, matching
`metaLines`. The whole line is capped at 300 characters.

- `ok(structuredContent, summary?)` uses `summarize()` unless the caller passes something
  better — a verdict, a count, the one number that was asked for.
- `okList`'s default `json` format summarizes too. `tsv`, `columnar`, `bare`, and `grouped`
  still render rows: those are explicit caller requests for a text view.
- A payload where everything is low-signal summarizes to `""`; `defineTool` substitutes the
  tool name, because a blank text block reads as a dropped response. `ok()` cannot do this
  itself — it does not know the tool's name.

`src/response.test.ts` holds the guard: for every registered tool's `outputSchema`, sampled
with oversized values, the text block must be shorter than `JSON.stringify` of the payload
above 200 B and must never contain a long field's contents.

## The malformed-frame investigation (AC-8): a negative result

The reduction above is worth shipping on its own, but it was **not** shown to be the cause
of the reported parse failures. `src/transport.stdio.test.ts` spawns the shipped bundle the
way a client does, speaks newline-delimited JSON-RPC at it, and collects any line that fails
to re-parse. Against **unmodified** code it found **zero malformed frames** — across a
pathological corpus (CRLF, embedded NUL, invalid UTF-8, a CESU-8 lone surrogate, astral
emoji, ~4 KB of quote-dense nested JSON), a whole-corpus single session that would expose a
desynced framer, and a replay of the exact file and byte range from the original report.

So: the framing is clean at this layer, and the defect that produced those reports was not
reproduced here. Recording that plainly matters more than a tidy causal story — the next
person to see the symptom should not re-run this harness expecting it to fail. No upstream
issue has been filed, because there is no reproducer to attach to one; what remains for
upstream is the raw client-side report, not a finding from this repo.

The harness stays in `npm test` (via `pretest`) regardless. It is the only place a framing
or escaping regression could ever show up.

## Considered options

- **Keep the payload in the text block for non-structured clients.** Rejected: it doubles
  every response for every client to serve a consumer that would still be better off asking
  for `format: "tsv"`, which is preserved.
- **Truncate the serialized payload instead of summarizing it.** Rejected: a truncated JSON
  document is neither readable nor parseable, and it still pays for the escaping.

## Consequences

- **Breaking for text-only clients.** A consumer that read `content[0].text` as JSON gets a
  summary line instead. This is the 2.0.0 break.
- Response size drops by roughly the size of the payload on every `ok()` call.
- A tool that has something better to say should say it: pass an explicit `summary`.
- ADR-0006's text-shaping mechanics survive for the non-`json` formats; its token rationale
  died with ADR-0009 and its default-format scope dies here.
