# ADR-0010: The benchmark corpus is also the behavioral contract corpus

- **Status:** Accepted
- **Date:** 2026-08-03
- **Related:** [ADR-0009](0009-structuredcontent-is-what-the-agent-reads.md)

## Context

`fixtures/benchmarks/<id>/` holds a `raw.txt` (what the CLI prints) and an `expected.txt`
(what the tool returns). Both were written by hand. `src/benchmark.fixtures.test.ts` counted
their tokens and checked them against a budget — nothing ever ran a handler against them.

So the pair was only ever a claim. `ls/expected.txt` described a payload the `ls` handler had
never emitted: on macOS `ls -lh` prints `Aug  3 13:12` where GNU prints `2026-05-31 12:00`,
and the parser took the name from `parts.slice(6)`, so every macOS entry came back named
`3 13:12 package.json`. The fixture said otherwise and the budget was priced off the fixture.
The same gap hid a `find` filter that silently widened the search on unparseable input, a
`tree` fallback that marked every entry a file, and two `tf_plan_summary` code paths that
counted a replace differently.

The cause is structural, not clerical: handlers are closures created inside
`register<Group>Tools`, and `exec` is a static import, so there was no way to call a handler
without spawning a process. 14 of 30 group tests asserted only that registration doesn't
throw.

## Decision

The corpus is executable. `src/benchmark.roundtrip.test.ts` feeds each fixture's CLI output
to the real handler through a mocked `#exec` and asserts the payload equals `expected.txt`.

- **`expected.txt` is the contract.** A mismatch is a handler bug until someone argues
  otherwise; the fixture is not adjusted to match observed output.
- **`handler-stdout.txt` is the machine form.** `raw.txt` must stay in the human form the
  benchmark prices (`git log`'s paragraphs, `tree`'s ASCII art), but several tools invoke the
  CLI in a machine form instead (`--format=%H‖…`, `tree -J`, `du -k`). Those fixtures carry an
  optional third file holding that form; it is the handler's input where it exists.
- **A platform difference belongs in the flags, not the parser.** Where one payload can be
  produced on both platforms, pin it with a flag (`ls -D "%Y-%m-%d %H:%M"` ≡
  `--time-style=iso`); where it can't, pick the unit both can report (`du -k` on both, giving
  up Linux's exact bytes).
- **The corpus only claims single-`exec` tools.** Multi-call and file-reading tools
  (`check_environment`, `kube_diagnose_pod`, `tf_outputs`, the liquibase group) stay on
  per-group tests, as do error branches and fallbacks no fixture can express.

`src/test-support.ts` is the seam: a capturing `McpServer` stub that hands back the
registered handlers, plus `execOk`/`execFail`. Test-only, tree-shaken out of the bundle.

## Considered options

- **Capture real CLI output into the fixtures.** Rejected: the fixtures are synthetic and
  redacted on purpose — this is a public repo and live capture would leak cluster, namespace,
  and pod names.
- **Extract each parser into a pure function and test that instead.** Rejected: the bugs were
  all in the *call* — which flag was passed, which exit code was ignored, which branch ran.
  Pure-parser tests move the untested surface rather than shrinking it.
- **Refactor handlers out of the closures into exported functions.** Rejected as
  unnecessary: the capture stub reaches them as they are, in 74ms, without touching
  production structure.

## Consequences

- Adding a benchmark fixture now also adds a behavioral assertion. A tool whose payload
  changes shape must update `expected.txt`, and updating it re-prices the budget — the two
  can no longer drift apart.
- `expected.txt` values are exact, including arithmetic: `ls`'s `8.2K` is `Math.round(8.2 *
  1024)` = `8397`, not a hand-rounded `8396`.
- Fixtures excluded from the round-trip table are listed with their reason in the test's
  header comment. Adding a tool to the table is preferred over widening the exclusions.
