# Token Benchmarks

How many tokens does structured output actually save? This page reports measured
token counts for raw CLI text vs. the structured response `bash-mcp` returns for the
same operation, across a representative subset of the wrappers over text-emitting
CLIs (not every tool — `jq`, `yq`, `find_files`, `glob`, the `*_summary` diagnostics,
and others are omitted).

## Method

`scripts/token-benchmark.mjs` tokenizes the captured fixtures in
`fixtures/benchmarks/` (per tool: `raw.txt` = CLI capture, `expected.txt` = the payload the
client receives) and reports the per-command and aggregate reduction. Run it yourself:

```bash
node scripts/token-benchmark.mjs          # print the report
node scripts/token-benchmark.mjs --write  # regenerate the tables in this doc
```

The fixtures are the single source of truth: the tables below are **generated** from them
(don't hand-edit the marked regions), and `src/benchmark.fixtures.test.ts` guards them in
CI — it asserts each tool's `expected.txt` stays under the per-tool token budget recorded in
`fixtures/benchmarks/manifest.json` and that these tables still match the fixtures (so the
doc can't drift). Add a tool by dropping a new `fixtures/benchmarks/<id>/{raw,expected}.txt`
pair plus a manifest entry, then re-run with `--write`.

**What "structured" means here.** Each `bash-mcp` tool returns both a `structuredContent`
(the typed JSON payload) and a `content` text block. **A client that understands
`structuredContent` renders that and ignores the text block** — Claude Code does. So the
benchmark measures `JSON.stringify(structuredContent)`, the artifact the agent is actually
charged tokens for. See [ADR-0009](adr/0009-structuredcontent-is-what-the-agent-reads.md).

Until 2026-08-03 this suite measured the **text block** instead — the compact `bare`/TSV/
`grouped` rendering — for the 17 wrappers that build one. That artifact never reached the
agent, so the published headline (62% token-weighted) described work the model never saw.
Re-baselining those 17 fixtures onto the payload — no tool change, only a change in what is
counted — dropped the honest headline to **50%** and put 15 of 35 tools in the red, because
**field curation and `format`/`fields` shape the text block only, so they save the agent
nothing.** The payload reshaping that followed (see the worst-offender ranking below) moved
that curation into `structuredContent` itself and brought the headline to the 59% reported
here, with 9 tools still net-negative.

**Tokenizer.** By default the script uses [`js-tiktoken`](https://www.npmjs.com/package/js-tiktoken)
with the `o200k_base` encoding (GPT-4o/o200k). This is a **GPT tokenizer used as a proxy
for Claude** — Claude's tokenizer differs, so the *absolute* counts below won't match what
Claude sees. The robust, tokenizer-independent figure is the **relative reduction**.

For **exact Claude counts**, run with `USE_CLAUDE_TOKENIZER=1` and a direct Anthropic API
key in `ANTHROPIC_API_KEY` — the script then calls the [`count_tokens`](https://docs.anthropic.com/en/docs/build-with-claude/token-counting)
API instead of the proxy:

```bash
USE_CLAUDE_TOKENIZER=1 ANTHROPIC_API_KEY=sk-... node scripts/token-benchmark.mjs
```

The API wraps each sample in a user message, so its counts carry a small constant
per-call overhead (a few tokens) that slightly dampens the reductions — the *relative*
figure still holds. This path needs a direct Anthropic key; it does not work through
Vertex/Bedrock gateways.

## Results

Measured with `o200k_base` (positive `saved` = structured is smaller):

<!-- BENCHMARK:RESULTS START -->
| Command | raw | struct | saved |
| --- | ---: | ---: | ---: |
| `liquibase updateSQL` (→ `liquibase_update_sql`) | 2953 | 181 | 94% |
| `dotnet test` (→ `dotnet_test`) | 1027 | 103 | 90% |
| `shellcheck` (→ `bash_lint`) | 366 | 73 | 80% |
| `terraform plan` (→ `tf_plan_summary`) | 220 | 55 | 75% |
| `pytest` (→ `python_test`) | 174 | 45 | 74% |
| `git diff` (→ `git_diff`) | 161 | 56 | 65% |
| `ruff check` (→ `python_lint`) | 254 | 90 | 65% |
| `kubectl describe pod` (→ `kube_diagnose_pod`) | 309 | 112 | 64% |
| `cat full file` (→ `outline`) | 232 | 94 | 59% |
| `helm status` (→ `helm_status`) | 123 | 56 | 54% |
| `git status` (→ `git_status`) | 116 | 53 | 54% |
| `dotnet build` (→ `dotnet_build`) | 150 | 77 | 49% |
| `kubectl logs (ERROR filter)` (→ `kube_logs`) | 143 | 82 | 43% |
| `argocd app get` (→ `argo_app_detail`) | 158 | 98 | 38% |
| `git log` (→ `git_log`) | 143 | 94 | 34% |
| `argocd app list` (→ `argo_apps`) | 149 | 102 | 32% |
| `liquibase status` (→ `liquibase_status`) | 1270 | 880 | 31% |
| `liquibase validate` (→ `liquibase_validate`) | 217 | 154 | 29% |
| `rg process.env` (→ `rg_extract`) | 104 | 75 | 28% |
| `which + version probes` (→ `check_environment`) | 118 | 87 | 26% |
| `kubectl config get-contexts` (→ `kube_contexts`) | 44 | 34 | 23% |
| `helm list -A` (→ `helm_list`) | 149 | 117 | 21% |
| `tsc --noEmit` (→ `npm_typecheck`) | 73 | 63 | 14% |
| `tree` (→ `tree`) | 81 | 70 | 14% |
| `kubectl get pods -A` (→ `kube_get`) | 234 | 226 | 3% |
| `kubectl get events` (→ `kube_events_summary`) | 141 | 137 | 3% |
| `ls -lh` (→ `ls`) | 146 | 153 | -5% |
| `mypy` (→ `python_typecheck`) | 88 | 94 | -7% |
| `bash -n` (→ `bash_syntax_check`) | 29 | 35 | -21% |
| `bats --tap` (→ `bash_test`) | 61 | 78 | -28% |
| `terraform output` (→ `tf_outputs`) | 54 | 73 | -35% |
| `git branch -v` (→ `git_branches`) | 53 | 73 | -38% |
| `du` (→ `du`) | 35 | 62 | -77% |
| `ripgrep` (→ `rg`) | 39 | 70 | -79% |
| `terraform state list` (→ `tf_state_list`) | 34 | 72 | -112% |
| **TOTAL (token-weighted)** | 9648 | 3924 | **59%** |
<!-- BENCHMARK:RESULTS END -->
<!-- generated by scripts/token-benchmark.mjs --write — do not edit by hand -->

Three aggregates, because the single TOTAL is misleading on its own:

<!-- BENCHMARK:AGGREGATES START -->
| Aggregate | Reduction | What it measures |
| --- | ---: | --- |
| Token-weighted total | **59%** | `(Σraw − Σstruct)/Σraw` — dominated by the few large samples (plan, describe, outline). |
| Median per-command reduction | **29%** | Robust central tendency across the 35 commands; ignores sample size. |
| Frequency-weighted total | **50%** | Weighted by an illustrative session mix (read/diff/log/diagnose dominate, bulk infra listings are rare — see `weight` in the manifest). |
<!-- BENCHMARK:AGGREGATES END -->

The frequency-weighted figure is the most representative of real usage: a triage or
dev session is mostly the high-saving diagnostic, diff, log, and file-read calls, not
repeated tiny `tf_state_list`/`rg` listings.

### Worst offenders, by weighted excess

9 of the 35 tools still return a payload **larger** than the raw CLI output they wrap. Ranked
by `(struct − raw) × weight` — the tokens a tool adds across an illustrative session, which
is the order the payload-reshaping work follows:

| Tool | excess/call | weight | weighted excess |
| --- | ---: | ---: | ---: |
| `rg` | +31 | 8 | **248** |
| `ls` | +7 | 6 | 42 |
| `git_branches` | +20 | 2 | 40 |
| `tf_state_list` | +38 | 1 | 38 |
| `du` | +27 | 1 | 27 |
| `tf_outputs` | +19 | 1 | 19 |
| `bash_test` | +17 | 1 | 17 |
| `python_typecheck` | +6 | 2 | 12 |
| `bash_syntax_check` | +6 | 1 | 6 |

Total excess is 449 tokens, down from 2343 across 15 tools before the reshape (`kube_get`
alone was 985 of that, and is now +3% saved). What remains is dominated by `rg`, and by the
floor every one of these hits: on a 3–7 item fixture, JSON's quotes, braces, and commas cost
more than the newline-and-space layout of the CLI they wrap, whatever the shape. The wins
show up on real-sized inputs — `rg` over a multi-file search pays each path once where the
raw output repeats it per match.

### Scaling: how the flat-list gap behaves at higher row counts

`tf_state_list`'s payload is a bare array of addresses plus the `byType` rollup — the
per-row field names are gone, and what is left is JSON's own punctuation. Measured on a
homogeneous list of N identical resources:

<!-- BENCHMARK:SCALING START -->
| N rows | raw | struct | saved |
| ---: | ---: | ---: | ---: |
| 5 | 45 | 67 | -49% |
| 50 | 450 | 517 | -15% |
| 200 | 1800 | 2017 | -12% |
| 1000 | 9000 | 10019 | -11% |
<!-- BENCHMARK:SCALING END -->

The gap **does not amortize**: per-row overhead is constant, so the deficit stays roughly
proportional in N — scale never helps. Dropping the fields derivable from `address` took the
series from −234% to −11%, and that is the floor for a flat list of strings: quoting and
comma-separating N addresses costs ~11% more than newline-separating them. Measuring the
text block hid all of this — `bare` text put one address per line and the same series read
−33% → −0%.

## How to read this

The table uses one sign convention: **positive `saved` = structured is smaller; negative =
structured costs more.** Two clear regimes emerge.

**Structured wins big on verbose, nested, and diagnostic output** — the cases that
dominate real triage. `terraform plan` (75% saved), `pytest` (74%), `git diff` (65%),
`kubectl describe`→`kube_diagnose_pod` (64%), and `cat`→`outline` (59%) all collapse
pages of human-formatted text (symbol legends, stack traces, full file bodies, multi-step
state) into the few fields an agent acts on. Diagnostics go further: one
`kube_diagnose_pod` call replaces a `get` + `describe` + `logs` sequence *and* the
reasoning across them.

**Small, already-terse flat lists still cost more than the CLI they wrap** — `tf_state_list`
−112%, `rg` −79%, `du` −77%, `bash_test` −66% — but far less than before. Three structural
causes, in the order they cost tokens, and what each one's fix bought:

1. **Repeated keys.** Each row re-serializes its field names. `tree`'s `{path,type,depth}`
   tripled the cost of a path; collapsing it to a marked path string took the tool from
   −117% to +14%. The lever is fewer keys per row, or none at all where a string encodes
   the same thing.
2. **Repeated values.** `rg` repeated the full file path on every match and `kube_get`
   `kind: Pod` on every item. Grouping by the repeated value (`rg`, diagnostics) or hoisting
   it to the top level (`kube_get`) pays it once per group instead of once per row —
   `kube_get` went from −84% to +3%.
3. **Fields the agent didn't ask for.** `du` carried `sizeHuman` (derivable from
   `sizeBytes`), `git_log` the full `hash` next to `shortHash`, `kube_get` the whole `labels`
   map (now behind `includeLabels`), `tf_state_list` `type`/`name`/`module` (all parseable
   from `address`). Each had already been dropped from the text view; moving that curation
   into the payload is what made it count.

What is left is JSON's own punctuation, which no reshape removes.

The three existing levers relate to this as follows:

- **`format` / `fields`** shape the text block only. They are spec-correct for clients that
  render `content[]`, and remain supported, but they save a `structuredContent`-rendering
  client nothing. They are no longer described as token controls.
- **Output budgets** (`detailLevel` / `maxItems`) do bite: they cap the rows in
  `structuredContent` itself, and truncated output notes `shown`/`total`.
- **Per-tool caps and projections that shrink the payload** — `rg`'s `maxResults`,
  `maxLineLength`, `only`, `filesOnly`, `maxPerFile`, `countPerFile`; `cat`'s
  `startLine`/`endLine`; `kube_get`'s `jq` — also bite, for the same reason.

**Structured still wins where the CLI is verbose.** Every positive row above is a case where
the raw text carries formatting the payload doesn't: `liquibase updateSQL` (94%),
`dotnet test` (90%), `terraform plan` (75%), `pytest` (74%), `git diff` (65%),
`kubectl describe`→`kube_diagnose_pod` (64%), `cat`→`outline` (59%). The diagnostic tools
win twice over, because one call replaces a `get` + `describe` + `logs` sequence *and* the
reasoning across it. Those wins are real and were never dependent on the text block.

The fixtures are small (3–7 items), and the remaining deficit does not amortize (see the
scaling table). The tools stay enabled: a negative row still buys a reliable parse, rollups
(`byType`), and fields the agent would otherwise derive by hand, and the alternative is raw
`Bash`, which costs the raw column *plus* the parsing. But "structured output saves tokens"
is still not true of those 9 tools on inputs this small.
`src/benchmark.fixtures.test.ts` enforces the per-tool budget so a reshape can't silently
regress.

**Bottom line: 59% fewer tokens token-weighted, 29% median, 50% on a realistic session mix.**
The headline is carried by the verbose-CLI cases; a handful of small flat-list wrappers still
subtract from it.

## Reproducing / extending

Add or edit a tool under `fixtures/benchmarks/`: create `<id>/raw.txt` (the CLI capture) and
`<id>/expected.txt` (`JSON.stringify` of the `structuredContent` that tool returns for the
same data — not its text block), then add a `{ id, command, weight, budget }` entry to `manifest.json` and
re-run with `--write`. The fixtures are checked in (not fetched live) so the benchmark runs
anywhere without a cluster, repo, or cloud credentials. Rendering, aggregation, and doc
generation live in `scripts/benchmark-core.mjs`, shared with the CI test.

Other knobs:

- **`budget`** (per manifest entry) — the token ceiling for that tool's `expected.txt`
  (generated as the measured count + ~10% headroom). The CI test fails if output exceeds it.
- **`weight`** (per manifest entry) — the illustrative call-frequency driving the
  frequency-weighted aggregate. Tune it to your own session mix; default is 1.
- **Scaling section** — `tfStateListRaw` / `tfStateListStructured` in `benchmark-core.mjs`
  generate the synthetic N-row series. Adjust `SCALING_N` or the generators to probe a
  different tool's scaling behavior.
- **`USE_CLAUDE_TOKENIZER=1`** — swaps the o200k proxy for exact Claude counts via the
  `count_tokens` API (needs `ANTHROPIC_API_KEY`; see [Method](#method)).
