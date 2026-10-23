# Changelog

Notable changes per release. Releases before 2.0.0 are in the git log
(`git log --oneline --grep '^chore(release)'`); this file starts where the first
breaking change did.

## 5.0.0 — Unreleased

### Breaking

- **Large results are cut to a budget by default.** `defineTool` fits every result to the
  `BASH_MCP_RESPONSE_MODE` budget (`auto` by default; `summary`, `compact`, `full`). A cut
  result keeps its schema, adds a `retained` record (`omitted: [{ path, total, shown }]`
  and an opaque `id`), and notes the cut in the text block. The full payload is stored for
  the session and paged with `result_get`. Clients that need the v4 shape set
  `BASH_MCP_RESPONSE_MODE=full`. A positional row is never cut, and a log's cut keeps
  its newest lines (`"from": "tail"`). See
  [ADR-0015](docs/adr/0015-definetool-fits-every-result-to-a-budget.md) and
  [ADR-0017](docs/adr/0017-budget-rows-are-atomic-and-logs-keep-the-tail.md).
- **`rg` omits `truncated` unless it is `true`.** Read a missing key as `false`.
- **Flat-list tools return rows as positional arrays.** Each tool's description names the
  order:
  - `du`: `entries` rows are `[path, sizeBytes]`.
  - `git_branches`: `branches` rows are `[name, lastCommit]`.
  - `ls`: `entries` rows are `[name, size, permissions, modified]`, or `[name]` under
    `nameOnly`. `total` and `path` are gone.
  - `tf_outputs`: `outputs` rows are `[name, value]`, or `[name]` for a sensitive output.
    `count` is gone.
  - `tf_state_list`: `count` is gone, and `byType` only appears above 20 resources.
  - `rg`: `files` rows are `[file, "line:text", …]`, `[file, count]` under
    `countPerFile`, or `[file]` under `filesOnly`. `fileCount` is gone.

  Take the dropped counts from the array length.
- **Repeated lines merge into one, with a count.** `run`, `run_seq`, `batch`, `kube_logs`,
  and the `gh_run_failure_summary`/`glab_pipeline_failure_summary` evidence merge each run
  of consecutive lines that differ only by a leading timestamp into its first line,
  marked ` [×N]`. Blank lines never merge. `run` takes `collapse: false` for verbatim
  output. `stdoutLines` still counts the original lines.
- **Diagnostic lists drop exact repeats.** Identical file/line/column/severity/rule/message
  findings appear once. When a budget cuts the list, errors are kept ahead of warnings;
  the kept findings stay in CLI order.
- **An unknown `BASH_MCP_PROFILE` or `BASH_MCP_RESPONSE_MODE` fails at startup** with
  the reason on stderr, instead of being ignored.

### Added

- `result_get`: page a stored result by `id`, `path`, `offset` and `limit`. Ids are
  bound to the session that made them; an expired, unknown or foreign id returns a typed
  error. Results live in memory only (`BASH_MCP_RESULT_TTL`, default 900 s;
  `BASH_MCP_RESULT_MAX_BYTES`, default 32 MB) and are never written to disk.
- `BASH_MCP_PROFILE` (`core`, `development`, `infrastructure`, `all`) registers a subset
  of tool groups. The default stays `all`. See
  [docs/guides/tool-discovery.md](docs/guides/tool-discovery.md) and
  [ADR-0016](docs/adr/0016-profiles-filter-registration.md).
- Cancellation: an MCP request abort stops the child process, and the exec result
  reports `cancelled: true`.
- Claude Code plugin (`.claude-plugin/`), installed with
  `/plugin install bash-mcp --marketplace nickw8/bash-mcp`. Its hook defaults to `warn`.
- `BASH_MCP_HOOK=block|warn|off` for the redirect hook, and `--uninstall-claude`.
- Installation guide for Claude Code, Claude Desktop, Cursor, VS Code/Copilot, Codex and
  generic stdio clients: [docs/guides/installation.md](docs/guides/installation.md).
- MCP Registry metadata (`server.json` as `io.github.nickw8/bash-mcp`, `mcpName` in
  `package.json`) and a tag-triggered release workflow: npm trusted publishing, then the
  registry through GitHub OIDC. Both steps skip a version that is already published.
- Benchmarks: a wire-size measurement, a six-scenario task eval
  (`scripts/task-eval.mjs`), an opt-in live-agent harness (`scripts/live-eval.mjs`, not
  in CI), and regression gates against the frozen v4.0.0 baseline.

### Fixed

- A timeout or abort kills the whole process group (POSIX), with SIGTERM followed by
  SIGKILL after 2 s. Before, only the direct child was killed, so its grandchildren kept
  running. Live children are also killed when the server exits.
- The text block is capped to the same budget as the payload.
- `kube_get` reports a pod's status the way `kubectl get pods` prints it. A crash-looping
  pod read `Running` (its phase); it now reads `CrashLoopBackOff`, and a failing init
  container reads `Init:<reason>`. The pod diagnostics fall back to the same status, and
  `kube_pod_failure_summary` treats `Completed` as healthy.
- Crash evidence names the container's last exit. A `CrashLoopBackOff` or repeatedly
  restarting container's evidence ends `; last exit 1 (Error)`, plus the first 200
  characters of its termination message. Before, only an `OOMKilled` crash had an exit
  code.
- `tf_plan_summary` without `planFile` counted a replacement as nothing and counted drift
  (`resource_drift`) as a planned change. It now counts a replace as one add and one
  destroy, as terraform's `Plan:` line and the `planFile` path do, skips drift, and takes
  terraform's `change_summary` totals when the stream has them.

### Migration

- Treat `retained` as "there is more"; call `result_get` with its `id` to read the rest,
  or set `BASH_MCP_RESPONSE_MODE=full`.
- Read `rg`'s `truncated` as optional.
- If a client lists too many tools, set `BASH_MCP_PROFILE`.

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
