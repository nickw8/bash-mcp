# Changelog

Notable changes per release. Releases before 2.0.0 are in the git log
(`git log --oneline --grep '^chore(release)'`); this file starts where the first
breaking change did.

## 4.0.0 — 2026-10-22

### Breaking

- **Commit lists drop the full `hash`.** `git_log`, `git_pr_context` and
  `repo_health_summary` return `shortHash` only. Pass it to `git_diff_content` as-is.
- **`npm_lint` answers in the shared diagnostics shape** that `python_lint` and
  `python_typecheck` use, with `format`, `fields` and the output budget.
- **Every Diagnostic run has one empty answer and one failure shape**, and the four test
  tools (`npm_test`, `python_test`, `dotnet_test`, `bash_test`) run through one Test run.
  Per-tool quirks in the empty and failure payloads are gone.
- **A CLI that never ran is an error, not a clean result.** A missing binary or a timeout
  used to come back as zero errors (`python_lint` without ruff) or as a silent exit
  (`run`, `run_seq`). It now comes back as an error that says the binary is
  "not installed or not on PATH", or that the command "timed out".

### Security

- `readOnly` classifies the command inside `sh -c`/`bash -c`, `sudo`/`env`/`xargs` and
  `find -exec`/`-delete`. Before, it only looked at the outer binary, so `sh -c "git push"`
  ran unblocked.

### Added

- GitHub: `gh_pr_checks` and the `gh_run_failure_summary` diagnostic.
- GitLab: `glab_ci_status` and the `glab_pipeline_failure_summary` diagnostic.
- `check_environment` probes `gh`, `glab`, `docker`, `python`, `pnpm`, `yarn`, `go` and
  `cargo`.
- `npm_test` runs jest when `package.json` uses it.
- An argument a tool requires is marked `Required.` in its description, so the
  advertised schema says so before the first call fails.
- Diagnostic tools declare `diagnostic: true` in `defineTool`.

### Fixed

- Triage suggestions carry the queried kube context, pod and namespace.
- `python_test` with `verbose` lists the passed and skipped tests too.
- `npm_lint` reads biome 2.x's JSON reporter and its count of fixed files.
- `readOnly` classifies a subcommand that comes after global flags and paths.

## 3.0.0 — 2026-08-19

### Breaking

- **An argument a tool does not declare is refused, not dropped.** `defineTool` registers
  each tool's schema as `z.object(shape).strict()`. A raw Zod shape becomes a *strip*-mode
  object, so an undeclared key used to be deleted and the handler ran as if it were never
  sent: `git_diff_content({ repoPath, commit, nameOnly })` lost all three keys, diffed the
  default repo at the default ref, and reported success. Such a call now fails with
  `MCP error -32602: … Unrecognized key(s) in object: …` naming the keys. The published
  JSON Schema is unchanged — it already said `additionalProperties: false`; the server now
  enforces it. See [ADR-0014](docs/adr/0014-an-undeclared-argument-is-refused.md).

### Added

- `find_files` accepts `pattern` as an alias for `name`. `rg` and `glob` both call the
  argument `pattern`, and under the change above that guess is a hard error rather than a
  silently dropped key.
- Transport coverage for both, over the shipped bundle: schema validation runs before the
  handler, so an in-process handler test cannot see it.

## 2.0.0 — 2026-08-19

### Breaking

- **The text block is a one-line summary, not the payload.** `content[0].text` used to
  carry `JSON.stringify(structuredContent)`; it now carries a summary line
  (`key=value` / `key[n]` / `key{n}`, long strings as `key=<bytes>B`, capped at 300
  characters). A client that reads `structuredContent` — Claude Code does — sees no
  change; a **text-only client that parsed `content[0].text` as JSON will break**. Ask for
  `format: "tsv"` (or `columnar` / `bare` / `grouped`) on a list tool to keep a rendered
  text view. See [ADR-0012](docs/adr/0012-the-text-block-is-a-summary.md).

### Added

- Missing required arguments come back as a readable `invalid_input` result instead of
  `MCP error -32602`. Tools declare them in `required: [...]` and `defineTool` checks them
  before the handler runs, so the response carries an error kind, a suggestion naming the
  argument, and a wide event. See
  [ADR-0013](docs/adr/0013-definetool-owns-required-arg-validation.md).
- A crash is reported instead of silently closing the pipe: `uncaughtException` and
  `unhandledRejection` emit one structured lifecycle event to stderr and exit non-zero.
- `E2BIG` (argument list too long) is classified as `invalid_input` and suggests passing
  the payload on stdin or via a file, rather than "check the command arguments".
- `src/transport.stdio.test.ts` — a stdio harness that spawns the built bundle and asserts
  every JSON-RPC frame round-trips, over a pathological corpus (CRLF, NUL, invalid UTF-8,
  lone surrogates, astral characters, quote-dense nested JSON).

### Changed

- `server_start` is only logged when `BASH_MCP_LOG=info`; a clean boot writes nothing to
  stderr. Fatal lifecycle events ignore the level. Amends
  [ADR-0004](docs/adr/0004-wide-events-to-stderr.md).
- Tools taking a path list (`cat`, `npm_lint`, `python_lint`, `python_typecheck`,
  `bash_lint`, `bash_syntax_check`) accept a bare string as well as an array.
- An empty array no longer satisfies a required argument. `bash_syntax_check({ files: [] })`
  used to check nothing and answer `valid: true`; it now returns `invalid_input` like any
  other missing argument. Applies to every array argument in a tool's `required` list.
