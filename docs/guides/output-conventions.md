# Output Conventions

Read when deciding what a tool returns, or why its text block differs from its
`structuredContent`. The mechanics come from
[ADR-0006](../adr/0006-compact-text-block-via-oklist.md) and
[ADR-0012](../adr/0012-the-text-block-is-a-summary.md); this is how to apply them.

**Before you optimise anything here:** `structuredContent` is what the agent is charged
tokens for — a client that understands it renders it and ignores the text block
([ADR-0009](../adr/0009-structuredcontent-is-what-the-agent-reads.md)). `format`, `fields`,
and row curation shape the **text block only** and save the model nothing. To cut tokens,
shrink the payload: fewer fields, shorter values, and payload-shrinking parameters
(`maxResults`, `maxLineLength`, `only`, `filesOnly`, the `budgetSchema` params).

## The text block is a summary line

`ok()` never serializes the payload into `content[0].text`. It writes a **summary line**:
one line of `key=value` / `key[n]` / `key{n}`, long strings reduced to `key=<bytes>B`,
low-signal fields dropped, the whole thing capped at 300 characters (`summarize` in
`src/format.ts`).

Pass a better one when you have it — `ok(payload, "3 errors in 2 files")` beats any
mechanical rendering of the same payload. If everything in the payload is low-signal the
summary is empty, and `defineTool` substitutes the tool name so the response never looks
dropped.

`okList` summarizes for its default `json` format too. `tsv`, `columnar`, `bare`, and
`grouped` still render rows: a caller asking for those is asking for a text view.
`src/response.test.ts` enforces the rule across every registered tool — the text block must
stay shorter than the serialized payload and must never carry a long field's contents.

## Which helper

| Shape | Helper |
|---|---|
| Single value | `ok(structured)` |
| Any flat list | `okList(structured, rows, meta, format)` — never `ok()` |
| Lint / typecheck / build findings | `diagnosticsResponse(structured, diagnostics, opts)` from `src/parsers/diagnostics-response.ts` — never `ok()` |
| Unrunnable command | `err(message, emptyStructured, toolError?)` |

`err`'s optional third `ToolError` argument merges `{ ok: false, error }`; two-argument
calls are byte-identical to before it existed.

## Formats

List tools accept `format`: `json` | `tsv` | `columnar` | `bare` | `grouped` (`ListFormat`
from `#format`).

- `bare` — headerless TSV, single-column, ≈ raw. Default for `tree`, `glob`, `tf_state_list`.
- `tsv` — default for multi-column: `ls`, `du`, `git_log`, `git_branches`, `tf_outputs`, `kube_contexts`.
- `grouped` — group rows by first column, header printed once (ripgrep style). Default for `rg` and the diagnostic tools.

`formatList` uses the union of keys across ragged rows and omits low-signal meta
(`false` / `null` / `undefined` / `""`). Meta values that are objects or arrays are
JSON-encoded (e.g. the `tf_state_list` `byType` rollup).

## Shaping the payload

This is the only lever that saves the agent tokens. Five moves, in the order they pay:

1. **Drop derived fields.** Anything computable from a sibling field goes: `du`'s
   `sizeHuman` (from `sizeBytes`), `git_log`'s full `hash` (a prefix-duplicate of
   `shortHash`), `tf_state_list`'s `type`/`name`/`module` (all parseable from `address`).
   Render them in the text rows instead if they read better there.
2. **Hoist what every item repeats.** `kube_get` lifts a uniform `kind`/`namespace` to the
   top level; `git_branches` and `kube_contexts` name the current entry once instead of a
   per-item `current` flag.
3. **Encode a tuple as a string.** `{path,type,depth}` → `"src/tools/"` (`tree`),
   `{line,column,severity,rule,message}` → `"12:9 TS2304 …"` (diagnostics), `{name,type}` →
   `"src/"` / `"link@"` (`ls`). Group by the repeated key so the path is paid once (`rg`,
   diagnostics).
4. **Return uniform rows as positional arrays.** `du`'s `[path, sizeBytes]`, `ls`'s
   `[name, size, permissions, modified]`, `rg`'s `[file, "line:text", …]`. Use arrays, not
   a `{key: value}` map: `fitToBudget` and `result_get` cut arrays only. Name the order in
   the tool description — clients don't show the model `outputSchema`. Drop counts the
   agent can take from the array length (`ls`'s `total`, `rg`'s `fileCount`).
5. **Make verbose data opt-in.** `kube_get`'s `labels` sit behind `includeLabels`.

Emit `total`/`truncated` when a cap bit, so a truncated payload says so.

## Curating rows

`rows` and `meta` drive the text block **for the row formats** — under the default `json`
they are unused, because that path summarizes. Curating them is a text-only change: safe for
consumers, and worth no tokens to the agent (ADR-0009) — do it for readability, not for
size. Multi-column list tools also accept `fields: string[]` →
`okList(s, rows, meta, fmt, { fields })`, projecting the text block to those columns only.

## Budgets

Variable-size lists spread `...budgetSchema` (`detailLevel`, `maxItems`, `includeRaw`) into
`inputSchema` and call `applyBudget(items, params)`. Emit `total` / `truncated` **only**
when a budget parameter was passed, so the no-parameter response shape is unchanged.

## Response budget

`defineTool` runs every result through `fitToBudget` (`src/budget.ts`) after the
handler, so tools never call it. `BASH_MCP_RESPONSE_MODE` picks the limit, in
serialized JSON characters: `summary` 4,000, `compact` 12,000, `auto` 16,000 (32,000
for an error or a non-Healthy diagnosis), `full` none. A call with
`detailLevel: "full"` skips it.

Over the limit, the biggest array is cut to a prefix, repeatedly, until it fits;
`likelyCauses` and `suggestedNextCommands` are never cut. The text block is capped to
the same limit at a line boundary. A cut is never silent: the payload gains

```json
"retained": {
  "mode": "auto",
  "omitted": [{ "path": "resources", "total": 2000, "shown": 210 }],
  "id": "r_…",
  "expiresInSec": 900
}
```

and the text block ends `[truncated to auto budget: resources 210/2000; rest:
result_get {"id":"r_…"} (900s)]`. Counts (`count`, `total`, `matchCount`) are computed
before the cut, so they stay true.

`id` points into the result store (`src/result-store.ts`): memory only, per session
(a stdio process is one session), TTL `BASH_MCP_RESULT_TTL`, capped by entries and
bytes, oldest evicted first. `result_get { id, path?, offset?, limit? }` pages it. An
expired id answers `not_found` with "expired"; another session's id answers
`not_found` exactly like an unknown one. A stored result is a snapshot of the original
call, under the same `BASH_MCP_MODE`, so it never shows more than that call could.
`id` is absent when the store is off or the payload is too big for it — the note then
says to narrow the call.

## Diagnostics

Spread `...diagnosticInputSchema` (`format`, `fields`, `detailLevel`, `maxItems`) into
`inputSchema` and `...diagnosticOutputSchema` (`errors`, `total`, `truncated`) into
`outputSchema`, then pass the counts plus
`{ format, fields, budget: { detailLevel, maxItems }, meta: { errorCount, ... } }`.

`diagnosticsResponse` owns the diagnostics list in **both** slots: it writes the grouped,
budget-capped findings into the payload under `key` (default `errors`; `dotnet_build` passes
`"diagnostics"`), so callers pass the surrounding counts only. The payload shape is
`[{ file, items: ["12:9 TS2304 Cannot find name 'x'."] }]` — path once per file, each
finding one `line:col [severity] [rule] message` string, severity present only when the set
is mixed. Tools that bypass the helper (`npm_lint`) call `compactDiagnostics` directly.

Text rows follow the same curation: `line`/`column` collapse into one `loc` cell, uniform
`severity` is dropped, absent `rule` is dropped.

## rg specifics

- The payload is grouped by file (`groupMatchesByFile` in `src/tools/search/parse.ts`): `files: [["src/a.ts", "26:const x = 1"]]`, path once and relative to `cwd`. Context lines use `-` instead of `:` as the separator, so the `kind` flag costs nothing.
- Matched line text is trimmed of leading indentation and windowed around the match by `windowMatchText` (`src/tools/search/window.ts`) using rg submatch offsets. `maxLineLength` defaults to 120 (0 = unlimited) so a minified line doesn't dump in full.
- `maxResults` defaults to 30. When the cap bites, a second `rg --count-matches` pass fills in the true `totalMatches` so the caller can narrow the pattern instead of guessing.
- `filesOnly` and `countPerFile` return the same `files` array, as `[file]` and `[file, count]` rows; `filesOnly` defaults to `bare`, `countPerFile` to `tsv`.

## Benchmarks and budget guards

`fixtures/benchmarks/` is the source of truth: per tool a `raw.txt` (CLI capture), an
`expected.txt` (`JSON.stringify` of the tool's `structuredContent` — the billed artifact,
never the text block), and a `manifest.json` (`{ id, command, weight, budget }`).
Budget = `ceil(o200k(expected) * 1.1 / 5) * 5` (measured count + ~10% headroom, rounded to 5).

- `scripts/token-benchmark.mjs` reads them; `--write` regenerates the tables in `docs/guides/token-benchmarks.md` between the `<!-- BENCHMARK:... -->` markers. Rendering and aggregation live in `scripts/benchmark-core.mjs`, shared with the test.
- Two CI guards: `src/format.budget.test.ts` (synthetic rows stay under budget and under JSON — guards the formatter) and `src/benchmark.fixtures.test.ts` (each tool's `expected.txt` is within its recorded budget, and the doc tables still match the fixtures).

When you intentionally change a tool's output: update `expected.txt`, re-baseline the
budget, re-run `--write`.
