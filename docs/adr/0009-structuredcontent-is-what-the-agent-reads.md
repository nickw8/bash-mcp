# ADR-0009: `structuredContent` is what the agent reads; the text block is not billed

- **Status:** Accepted
- **Date:** 2026-08-03
- **Supersedes:** [ADR-0006](0006-compact-text-block-via-oklist.md)

## Context

ADR-0006 was built on the premise that "only the text block of a response is token-counted
by the model". That is backwards for the client this server is written for. An MCP client
that understands `structuredContent` renders the typed payload and drops `content[0].text`
on the floor — Claude Code does. The trigger is the *presence of `structuredContent`*, not
the declaration of `outputSchema`.

Every `okList` tool therefore spent its compaction budget on an artifact the model never
sees. Measured on a `rg` call with the most aggressive settings the tool offers
(`format: "bare"`, `fields: ["line"]`): the requested text view was ~13 characters; what
reached the agent was ~800 characters of payload JSON — absolute path repeated per match,
full line text, meta block. Roughly 60x, with `format`/`fields` contributing nothing.

The benchmark suite carried the same error: 17 of 35 `expected.txt` fixtures held the text
block, so the published 62% token-weighted headline described work the model never saw.
Re-baselining onto the payload gives 50% token-weighted, 26% median, 38% frequency-weighted,
with 15 of 35 tools returning *more* tokens than the CLI they wrap.

## Decision

`structuredContent` is the billed artifact. Every token claim, benchmark fixture, budget,
and compaction lever is measured against `JSON.stringify(structuredContent)`.

- Benchmark `expected.txt` holds the payload, never the text block.
- Payload shape is the lever: field names repeated per row, values repeated per row, and
  fields the caller didn't ask for are the cost. Fix them in the payload.
- Parameters that shrink the payload (`maxResults`, `maxLineLength`, `only`, `filesOnly`,
  `maxPerFile`, `countPerFile`, `cat`'s `startLine`/`endLine`, `kube_get`'s `jq`, the
  `budgetSchema` params) are the real controls, and are what tool descriptions and guidance
  advertise.
- `format` / `fields` / `columnar` / `grouped` / `bare` / `tsv` shape the text block only.
  They stay — they are spec-correct for clients that render `content[]` — but are no longer
  described anywhere as token controls.

## Considered options

- **Drop `outputSchema` (and `structuredContent`) on the expensive tools** so the formatted
  text block is what returns. Rejected: it breaks every non-Claude-Code consumer, throws
  away the typed contract that is the point of this server, and trades a payload-shaping
  problem for a protocol regression.
- **Keep measuring the text block and document the caveat.** Rejected: the headline number
  would stay honest-looking and wrong, and no reshaping work would ever get prioritised.

## Consequences

- ADR-0006's mechanics (`okList`, curated `rows`, `bare`/`tsv`/`grouped` defaults) remain in
  the code and remain correct for text-rendering clients. Only its token rationale is dead.
- Several tools were measurably negative. That is a real finding about the payloads, not a
  measurement artifact, and it was worked in descending `(struct − raw) × weight` order:
  reshaping the payloads of `kube_get`, `rg`, `tree`, `ls`, `du`, `git_log`, `git_branches`,
  `tf_state_list`, `tf_outputs`, `kube_contexts` and the shared diagnostics list took the
  headline to 59% token-weighted / 29% median / 50% frequency-weighted and cut the total
  weighted excess from 2343 tokens across 15 tools to 449 across 9. See the worst-offender
  table in [token-benchmarks.md](../token-benchmarks.md).
- `src/format.budget.test.ts` still guards the formatter, but it guards text nobody is
  charged for; `src/benchmark.fixtures.test.ts` is now the guard that matters.
- Curating `rows` is still safe (text-only) — and still saves the agent nothing.
