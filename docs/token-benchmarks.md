# Token Benchmarks

How many tokens does structured output actually save? This page reports measured
token counts for raw CLI text vs. the structured response `bash-mcp` returns for the
same operation, across the full set of wrappers over text-emitting CLIs.

## Method

`scripts/token-benchmark.mjs` (a one-off script, not part of the test suite) tokenizes
representative, hand-captured CLI outputs and the corresponding `bash-mcp` responses,
then reports the per-command and aggregate reduction. Run it yourself:

```bash
node scripts/token-benchmark.mjs
```

**What "structured" means here.** Each `bash-mcp` tool returns both a `structuredContent`
(JSON) and a `content` text block. The benchmark uses each tool's **default text
representation**: TSV for the list tools that emit it (`ls`, `rg`, …) and JSON for the
rest. This is the conservative, real-world output — JSON is the larger of the two, so
tools that default to TSV would look even better if compared as JSON.

**Tokenizer caveat.** The script uses [`js-tiktoken`](https://github.com/dqbd/tiktoken)
with the `o200k_base` encoding (GPT-4o/o200k). This is a **GPT tokenizer used as a proxy
for Claude** — Claude's tokenizer differs, so the *absolute* counts won't match what
Claude sees. The robust, tokenizer-independent figure is the **relative reduction**.

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
| `kubectl logs` ERROR filter (→ `kube_logs`)|  143 |     82 |  43% |
| `argocd app get` (→ `argo_app_detail`)     |  158 |     98 |  38% |
| `argocd app list` (→ `argo_apps`)          |  149 |    102 |  32% |
| `dotnet build` (→ `dotnet_build`)          |  150 |    104 |  31% |
| `which`+versions (→ `check_environment`)   |  118 |     87 |  26% |
| `helm list -A` (→ `helm_list`)             |  149 |    117 |  21% |
| `ls -lh` (→ `ls`, TSV)                      |  146 |    116 |  21% |
| `kubectl get events` (→ `kube_events_summary`) | 141 | 137 |   3% |
| `git log` (→ `git_log`)                    |  143 |    165 | −15% |
| `tsc --noEmit` (→ `npm_typecheck`)         |   73 |     86 | −18% |
| `kubectl get pods -A` (→ `kube_get`)       |  234 |    295 | −26% |
| `kubectl config get-contexts` (→ `kube_contexts`) | 44 | 59 | −34% |
| `ripgrep` (→ `rg`, TSV)                     |   39 |     59 | −51% |
| `terraform output` (→ `tf_outputs`)        |   54 |     90 | −67% |
| `git branch -v` (→ `git_branches`)         |   53 |     97 | −83% |
| `tree` (→ `tree`)                          |   81 |    164 | −102% |
| `du` (→ `du`)                              |   35 |    102 | −191% |
| `terraform state list` (→ `tf_state_list`) |   34 |    162 | −376% |
| **TOTAL**                                 | 3279 |   2593 |  **21%** |

## How to read this

Two clear regimes:

**Structured wins big on verbose, nested, and diagnostic output** — the cases that
dominate real triage. `terraform plan` (−75%), `pytest` (−74%), `git diff` (−65%),
`kubectl describe`→`kube_diagnose_pod` (−64%), and `cat`→`outline` (−59%) all collapse
pages of human-formatted text (symbol legends, stack traces, full file bodies, multi-step
state) into the few fields an agent acts on. Diagnostics go further: one
`kube_diagnose_pod` call replaces a `get` + `describe` + `logs` sequence *and* the
reasoning across them.

**Small, already-terse flat lists can cost more as JSON.** `terraform state list`
(+376%), `du` (+191%), and `tree` (+102%) are the worst cases: the raw output is a bare
column of strings, while JSON repeats every field name on every row. Here the value of
`bash-mcp` is **reliability and pre-computation** (typed fields, `byType` rollups,
grouped resources) rather than token count — and three things shrink or flip the gap:

1. **Compact list formats.** List tools (`ls`, `rg`, `find_files`, `glob`) default to
   **TSV**, which writes each field name once. `ls` at +21% is already TSV; the JSON-only
   tools (`tree`, `du`, `git_branches`) could adopt the same `format` param.
2. **Output budgets.** `detailLevel` / `maxItems` cap large lists so the agent never pays
   for rows it won't read.
3. **Scale.** JSON's per-row key overhead is *fixed per field*; raw text grows with column
   width and with the number of fields the agent would otherwise have to parse. The 5-row
   samples here are the worst case — a 200-resource `tf_state_list` amortizes the keys and
   the `byType` summary becomes a net win.

**Aggregate: ~21% fewer tokens** across this representative mix — and that *under*-weights
real usage, where a triage session is mostly the high-saving diagnostic and diff/log/plan
calls, not repeated tiny `du`/`tree` listings.

## Reproducing / extending

Edit the `SAMPLES` array in `scripts/token-benchmark.mjs` to add commands or swap in your
own captured output, then re-run. Each entry is `{ tool, raw, structured }`; the samples
are checked into the script (not fetched live) so the benchmark runs anywhere without a
cluster, repo, or cloud creds. To benchmark a list tool's TSV vs JSON form, put the
representation you want to measure in the `structured` field.
