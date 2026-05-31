# Token Benchmarks

How many tokens does structured output actually save? This page reports measured
token counts for raw CLI text vs. the structured JSON `bash-mcp` returns for the
same operation.

## Method

`scripts/token-benchmark.mjs` (a one-off script, not part of the test suite) tokenizes
representative, hand-captured CLI outputs and the corresponding `bash-mcp` responses,
then reports the per-command and aggregate reduction. Run it yourself:

```bash
node scripts/token-benchmark.mjs
```

**Tokenizer caveat.** The script uses [`js-tiktoken`](https://github.com/dqbd/tiktoken)
with the `o200k_base` encoding (GPT-4o/o200k). This is a **GPT tokenizer used as a proxy
for Claude** — Claude's tokenizer differs, so the *absolute* counts won't match what
Claude sees. The robust, tokenizer-independent figure is the **relative reduction**,
which is the headline below.

## Results

Measured with `o200k_base` (lower `struct` is better; `saved` = reduction vs. raw):

| Command                                   |  raw | struct | saved |
|-------------------------------------------|-----:|-------:|------:|
| `kubectl get pods -A`                      |  234 |    295 |  −26% |
| `kubectl describe pod` (→ `kube_diagnose_pod`) | 309 | 112 |  64% |
| `kubectl logs` (ERROR filter)             |  143 |     82 |  43% |
| `terraform plan`                          |  220 |     55 |  75% |
| `helm list -A`                            |  149 |    117 |  21% |
| `argocd app list`                         |  149 |    102 |  32% |
| `git diff` (→ `git_diff`)                  |  161 |     56 |  65% |
| **TOTAL**                                 | 1365 |    819 |  **40%** |

A typical triage session that touches several of these collapses to roughly **40% fewer
tokens** overall.

## Where the savings come from (and where they don't)

The wins are largest where raw output is **verbose, nested, or needs cross-referencing**:

- **Diagnostics collapse multi-step reasoning.** `kube_diagnose_pod` turns a 300-token
  `kubectl describe` dump into a 112-token answer (status + likely causes + suggested
  next commands + evidence) — and replaces *several* round-trips with one call.
- **Plans and diffs drop boilerplate.** `terraform plan` (−75%) and `git diff` (−65%)
  strip ASCII formatting, symbol legends, and unchanged context the agent doesn't need.
- **Filtering happens server-side.** `kube_logs` with a `grep` pattern returns only the
  matching lines, instead of the agent paying tokens for the full log to filter itself.

The one case that does **not** shrink is a **flat table** like `kubectl get pods -A`
(−26%): JSON repeats every field name on every row, so for a small, already-compact table
it costs *more* than the raw text. This is expected, and there are two mitigations:

1. **Compact list formats.** List-style tools (`ls`, `rg`, `find_files`, `glob`, …) accept
   a `format` param (`tsv` | `columnar` | `json`, default `tsv`); TSV writes each field
   name once, recovering the gap.
2. **Output budgets.** `detailLevel` / `maxItems` cap large lists so the agent never pays
   for rows it won't read.

Even when token counts are break-even, structured output is **more reliable**: the agent
gets typed fields instead of guessing column boundaries from whitespace-aligned text, and
never re-parses on a format change.

## Reproducing / extending

Edit the `SAMPLES` array in `scripts/token-benchmark.mjs` to add commands or swap in your
own captured output, then re-run. The samples are deliberately checked into the script
(not fetched live) so the benchmark runs anywhere without a cluster, repo, or cloud creds.
