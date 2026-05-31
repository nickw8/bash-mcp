# Token Benchmarks

How many tokens does structured output actually save? This page reports measured
token counts for raw CLI text vs. the structured response `bash-mcp` returns for the
same operation, across a representative subset of the wrappers over text-emitting
CLIs (not every tool — `jq`, `yq`, `find_files`, `glob`, the `*_summary` diagnostics,
and others are omitted).

## Method

`scripts/token-benchmark.mjs` (a one-off script, not part of the test suite) tokenizes
representative, hand-captured CLI outputs and the corresponding `bash-mcp` responses,
then reports the per-command and aggregate reduction. Run it yourself:

```bash
node scripts/token-benchmark.mjs
```

**What "structured" means here.** Each `bash-mcp` tool returns both a `structuredContent`
(JSON, for programmatic use) and a `content` text block (what the model actually reads and
token-counts). The benchmark measures the **text block** — each tool's **default text
representation**: `bare` (values only) or `TSV` (header + tab-separated) for list tools,
JSON for the rest. Field-curated text views (e.g. `du` drops the derived `sizeHuman`,
`git_log` drops the redundant full hash) keep `structuredContent` complete — only the text
block is trimmed, so the savings cost nothing programmatically.

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

| Command (→ tool)                          |  raw | struct | saved |
|-------------------------------------------|-----:|-------:|------:|
| `terraform plan` (→ `tf_plan_summary`)     |  220 |     55 |  75% |
| `pytest` (→ `python_test`)                 |  174 |     45 |  74% |
| `git diff` (→ `git_diff`)                  |  161 |     56 |  65% |
| `kubectl describe pod` (→ `kube_diagnose_pod`) | 309 | 112 |  64% |
| `cat` full file (→ `outline`)              |  232 |     94 |  59% |
| `git status` (→ `git_status`)              |  116 |     53 |  54% |
| `helm status` (→ `helm_status`)            |  123 |     56 |  54% |
| `git log` (→ `git_log`, TSV)               |  143 |     77 |  46% |
| `kubectl logs` ERROR filter (→ `kube_logs`)|  143 |     82 |  43% |
| `argocd app get` (→ `argo_app_detail`)     |  158 |     98 |  38% |
| `kubectl config get-contexts` (→ `kube_contexts`, TSV) | 44 | 29 | 34% |
| `argocd app list` (→ `argo_apps`)          |  149 |    102 |  32% |
| `dotnet build` (→ `dotnet_build`)          |  150 |    104 |  31% |
| `tree` (→ `tree`, bare)                     |   81 |     59 |  27% |
| `which`+versions (→ `check_environment`)   |  118 |     87 |  26% |
| `helm list -A` (→ `helm_list`)             |  149 |    117 |  21% |
| `ls -lh` (→ `ls`, TSV)                      |  146 |    116 |  21% |
| `kubectl get pods -A` (→ `kube_get`, TSV)   |  234 |    206 |  12% |
| `kubectl get events` (→ `kube_events_summary`) | 141 | 137 |   3% |
| `du` (→ `du`, TSV)                          |   35 |     35 |   0% |
| `terraform output` (→ `tf_outputs`, TSV)   |   54 |     56 |  −4% |
| `git branch -v` (→ `git_branches`, TSV)    |   53 |     59 | −11% |
| `tsc --noEmit` (→ `npm_typecheck`)         |   73 |     86 | −18% |
| `ripgrep` (→ `rg`, TSV)                     |   39 |     55 | −41% |
| `terraform state list` (→ `tf_state_list`, bare) | 34 | 67 | −97% |
| **TOTAL (token-weighted)**                 | 3279 |   2043 |  **38%** |

Three aggregates, because the single TOTAL is misleading on its own:

| Aggregate                       | Reduction | What it measures |
|---------------------------------|----------:|------------------|
| Token-weighted total            |   **38%** | `(Σraw − Σstruct)/Σraw` — dominated by the few large samples (plan, describe, outline). |
| Median per-command reduction    |   **31%** | Robust central tendency across the 25 commands; ignores sample size. |
| Frequency-weighted total        |   **40%** | Weighted by an illustrative session mix (read/diff/log/diagnose dominate, bulk infra listings are rare — see `WEIGHTS` in the script). |

> These numbers reflect the compact-format work described in [How to read this](#how-to-read-this):
> the flat-list tools (`tree`, `du`, `git_log`, `git_branches`, `tf_state_list`, `tf_outputs`,
> `kube_contexts`, `kube_get`) now default to `bare`/`TSV` text, omit low-signal meta, and curate
> redundant columns. Before that change the same mix scored 21% / 21% / 28% — several tools were
> deeply negative (`tf_state_list` −376%, `du` −191%, `tree` −102%, `kube_get` −26%, `kube_contexts` −34%).

The frequency-weighted figure is the most representative of real usage: a triage or
dev session is mostly the high-saving diagnostic, diff, log, and file-read calls, not
repeated tiny `tf_state_list`/`rg` listings.

### Scaling: how the flat-list gap behaves at higher row counts

`tf_state_list` now defaults to `bare` text (one address per line, with the `byType` rollup
in the meta block). Measured on a homogeneous list of N identical resources:

| N rows |  raw | struct | saved |
|-------:|-----:|-------:|------:|
|      5 |   45 |     60 | −33% |
|     50 |  450 |    465 |  −3% |
|    200 | 1800 |   1815 |  −1% |
|   1000 | 9000 |   9017 |  −0% |

The gap **closes toward 0% as rows grow**: bare per-row cost equals the raw address, so the
only overhead is the fixed `count`/`byType` meta block, which amortizes away. (For
comparison, the old JSON default plateaued near **−234%** here — it repeated four field
names on every row, so scale never helped. The fix was the format, not the row count.) And
unlike raw, the structured form still carries the `byType` summary the agent would otherwise
have to compute.

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

**Small, already-terse flat lists used to cost more as JSON — now they don't.** When these
tools serialized full JSON, the raw output was a bare column of strings while JSON repeated
every field name on every row: `tf_state_list` was −376%, `du` −191%, `tree` −102%. The fix
was to emit compact text by default while keeping `structuredContent` as JSON:

1. **Compact list formats (the main lever).** List tools now route their text block through
   `formatList` with a non-JSON default — **`bare`** (values only, no header) for
   single-column lists (`tree`, `tf_state_list`, `glob`) and **`TSV`** (header + tab rows)
   for multi-column ones (`ls`, `rg`, `du`, `git_log`, `git_branches`, `tf_outputs`,
   `kube_contexts`). Each still accepts a `format` param to override. This is what turned
   `tf_state_list` −376% → −97% (and → ~0% at scale), `du` → 0%, `tree` → +27%.
2. **Field curation.** The text view drops fields the agent can recompute or that duplicate
   others, while `structuredContent` keeps them: `du` omits the derived `sizeHuman`,
   `git_log` drops the full `hash` (keeps `shortHash`) → −15% to **+46%**, `tf_outputs`
   drops the verbose `type`, `git_branches` omits the all-`false` `remote` column.
3. **Output budgets.** `detailLevel` / `maxItems` cap large lists so the agent never pays
   for rows it won't read.
4. **Agent-driven levers.** Most list tools take a `fields` param to project just the columns
   the task needs (text view only — `structuredContent` keeps every field), and `cat` accepts
   `paths` to read several files in one call. These cut tokens the encoding work can't, by
   removing whole columns and whole round-trips.

`kube_get` flattens its summarized rows (the per-item `extra` map — replicas, restarts, type —
becomes top-level TSV columns; verbose `labels` stay in `structuredContent`), which flipped it
from −26% to +12%.

**What's still negative, and why:**

- `tf_state_list` (−97% at 5 rows) and `rg` (−41%): tiny results where the fixed meta/header
  block dominates. Both amortize toward ~0% as rows grow (see the scaling table); omitting
  low-signal meta (e.g. `truncated:false`) already trimmed `rg` from −51%, and its `grouped`
  format collapses repeated file paths further on many-match-per-file results.
- `npm_typecheck` (−18%): genuinely structured diagnostics where the JSON envelope (file,
  line, column, rule, message per error) costs more than terse `tsc` text on a 2-error
  sample; it wins on larger error sets and pays for itself in parse reliability.

**Bottom line: ~38% fewer tokens token-weighted, 31% median, ~40% on a realistic session
mix** (up from 21% / 21% / 28% before the compact-format work) — and that still
under-weights real usage, dominated by the high-saving diagnostic, diff, log, and plan calls.

## Reproducing / extending

Edit the `SAMPLES` array in `scripts/token-benchmark.mjs` to add commands or swap in your
own captured output, then re-run. Each entry is `{ tool, raw, structured }`; the samples
are checked into the script (not fetched live) so the benchmark runs anywhere without a
cluster, repo, or cloud credentials. To benchmark a list tool's TSV vs JSON form, put the
representation you want to measure in the `structured` field.

Other knobs:

- **`WEIGHTS`** — the illustrative call-frequency map driving the frequency-weighted
  aggregate. Tune it to your own session mix; tools absent from the map default to 1.
- **Scaling section** — `tfStateListRaw` / `tfStateListStructured` generate the synthetic
  N-row series. Adjust the `[5, 50, 200, 1000]` list or the generators to probe a different
  tool's scaling behavior.
- **`USE_CLAUDE_TOKENIZER=1`** — swaps the o200k proxy for exact Claude counts via the
  `count_tokens` API (needs `ANTHROPIC_API_KEY`; see [Method](#method)).
