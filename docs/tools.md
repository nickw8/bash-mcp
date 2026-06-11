# Tool Reference

<!-- GENERATED FILE — do not edit by hand. Regenerate with `npm run docs:tools`. -->

60 tools. Each entry lists inputs, outputs, and (where known) the raw command(s) it approximates.

## `argo_app_detail`

`read-only`

Get detailed status for a single ArgoCD application including resource health.

**Inputs:**

- `name`: string — Application name

**Outputs:**

- `name`: string
- `project`: string
- `syncStatus`: string
- `healthStatus`: string
- `revision`: string
- `message`: string
- `resources`: object[]
- `conditions`: object[]

## `argo_app_diff`

`read-only`

Show what's out of sync for an ArgoCD application.

**Inputs:**

- `name`: string — Application name

**Outputs:**

- `hasDiff`: boolean
- `diff`: string

## `argo_app_health_summary`

`read-only`

Diagnose an ArgoCD application's health in one call: overall sync/health, likely causes, suggested next commands, and the unhealthy resources/conditions as evidence.

**Inputs:**

- `name`: string — Application name

**Outputs:**

- `name`: string
- `status`: string
- `syncStatus`: string
- `healthy`: boolean
- `likelyCauses`: string[]
- `suggestedNextCommands`: string[]
- `evidence`: string[]

**Equivalent commands:**

```sh
argocd app get <name> -o json
```

## `argo_apps`

`read-only`

List ArgoCD applications with sync/health status. Structured summary instead of table output.

**Inputs:**

- `project`: string _(optional)_ — Filter by ArgoCD project
- `selector`: string _(optional)_ — Label selector

**Outputs:**

- `apps`: object[]
- `count`: number
- `summary`: object

## `bash_lint`

`read-only`

Run shellcheck and return structured diagnostics with file, line, column, message, and SC rule code. Much more compact than raw shellcheck output. Use minSeverity to filter by severity level.

**Inputs:**

- `files`: string[] — Shell script paths to lint
- `minSeverity`: "error" | "warning" | "info" _(optional)_ — Minimum severity to include (e.g. 'error' drops warnings and info)
- `format`: "grouped" | "tsv" | "json" _(optional)_ — Text format: grouped (default, file header once then line:col rule message), tsv, or json
- `fields`: string[] _(optional)_ — Limit the text view to these columns (e.g. ['file','loc','message']); structuredContent keeps all
- `detailLevel`: "summary" | "normal" | "full" _(optional)_ — Output size preset: summary (~20 items), normal (~100), full (uncapped, default).
- `maxItems`: number _(optional)_ — Explicit cap on returned items; overrides detailLevel.

**Outputs:**

- `errors`: object[]
- `errorCount`: number
- `warningCount`: number

**Equivalent commands:**

```sh
shellcheck -f json1 script.sh
```

## `bash_syntax_check`

`read-only`

Check shell scripts for syntax errors with `bash -n` and return structured diagnostics (file, line, message). Parses without executing, so it is safe on untrusted scripts. Reports valid:true when no errors are found.

**Inputs:**

- `files`: string[] — Shell script paths to check
- `format`: "grouped" | "tsv" | "json" _(optional)_ — Text format: grouped (default, file header once then line:col rule message), tsv, or json
- `fields`: string[] _(optional)_ — Limit the text view to these columns (e.g. ['file','loc','message']); structuredContent keeps all
- `detailLevel`: "summary" | "normal" | "full" _(optional)_ — Output size preset: summary (~20 items), normal (~100), full (uncapped, default).
- `maxItems`: number _(optional)_ — Explicit cap on returned items; overrides detailLevel.

**Outputs:**

- `errors`: object[]
- `errorCount`: number
- `valid`: boolean

**Equivalent commands:**

```sh
bash -n script.sh
```

## `bash_test`

Run a shell test script — bats `.bats` files via `--tap`, or a plain `.sh` harness — and return structured results: per-case pass/fail plus a summary parsed from TAP or `N tests, M failures` output, falling back to exit-code-only when the format is unrecognized. Executes the script, so it is gated by BASH_MCP_MODE.

**Inputs:**

- `file`: string — Test script path (.bats or .sh)
- `cwd`: string _(optional)_ — Working directory
- `timeout`: number _(optional)_ — Timeout in ms

**Outputs:**

- `summary`: object
- `tests`: object[]
- `exitCode`: number

**Equivalent commands:**

```sh
bats --tap test.bats
bash test.sh
```

## `batch`

Run multiple shell commands in parallel and return all results. Use when you need to gather independent pieces of information in a single tool call instead of multiple sequential calls.

**Inputs:**

- `commands`: object[]

**Outputs:**

- `results`: object[]
- `elapsed`: number

## `cat`

`read-only`

Read one or more files with line numbers and smart truncation. Returns structured output with metadata. Pass `path` for a single file, or `paths` to read several in one call (returns { files, count }) — collapsing what would otherwise be multiple round-trips. For large files, use startLine/endLine or maxLines to limit output. Use ref to read from a git branch/commit instead of disk (e.g. ref='main'). NOTE: reading with cat does NOT satisfy the built-in Edit/Write "must read first" guard (it tracks only the built-in Read tool) — run the built-in Read on a file immediately before editing it.

**Inputs:**

- `path`: string _(optional)_ — Path to a single file
- `paths`: string[] _(optional)_ — Read multiple files in one call. Returns { files, count }; a per-file failure is reported in that file's `error` and does not abort the others.
- `ref`: string _(optional)_ — Git ref to read from (e.g. 'main', 'HEAD~1', a commit hash). When set, reads file content from git (git show ref:path) instead of disk.
- `startLine`: number _(optional)_ — Start reading from this line (1-based)
- `endLine`: number _(optional)_ — Stop reading at this line (inclusive)
- `maxLines`: number _(optional)_ — Max lines to return per file (default 200, use 0 for unlimited)
- `lineNumbers`: boolean _(optional)_ — Prepend line numbers to each line (useful when locating a line). Does not register the file as read for the built-in Edit — use the built-in Read right before editing.

**Outputs:**

- `path`: string _(optional)_
- `totalLines`: number _(optional)_
- `size`: number _(optional)_
- `mtime`: number _(optional)_ — File modification time (unix timestamp)
- `content`: string _(optional)_
- `range`: unknown _(optional)_
- `truncated`: boolean _(optional)_
- `error`: string _(optional)_
- `files`: object[] _(optional)_
- `count`: number _(optional)_

## `check_environment`

`read-only`

Report which CLIs are installed (and their versions) so you can pick the right tool before calling it. Probes are client-only and non-blocking — no server/auth calls. Includes kubectl's current context when available.

**Inputs:**

_no inputs_

**Outputs:**

- `tools`: object[]
- `installedCount`: number
- `total`: number

## `dotnet_build`

Run dotnet build and return structured diagnostics with file, line, column, message, and error code. Much more compact than raw MSBuild output.

**Inputs:**

- `cwd`: string — Project root directory
- `project`: string _(optional)_ — Path to .csproj or .sln file (default: auto-detected in cwd)
- `configuration`: string _(optional)_ — Build configuration (e.g. Debug, Release)
- `format`: "grouped" | "tsv" | "json" _(optional)_ — Text format: grouped (default, file header once then line:col rule message), tsv, or json
- `fields`: string[] _(optional)_ — Limit the text view to these columns (e.g. ['file','loc','message']); structuredContent keeps all
- `detailLevel`: "summary" | "normal" | "full" _(optional)_ — Output size preset: summary (~20 items), normal (~100), full (uncapped, default).
- `maxItems`: number _(optional)_ — Explicit cap on returned items; overrides detailLevel.

**Outputs:**

- `diagnostics`: object[]
- `exitCode`: number
- `errorCount`: number
- `warningCount`: number
- `summary`: string

## `dotnet_test`

Run dotnet test and return structured results: pass/fail/skip counts, failure messages. Much more compact than raw test output. Only failures are listed.

**Inputs:**

- `cwd`: string — Project root directory
- `filter`: string _(optional)_ — Test filter expression (e.g. 'FullyQualifiedName~MyTest')
- `project`: string _(optional)_ — Path to .csproj or .sln file (default: auto-detected in cwd)

**Outputs:**

- `exitCode`: number
- `passed`: number
- `failed`: number
- `skipped`: number
- `total`: number
- `failures`: object[]
- `summary`: string

## `du`

`read-only`

Show disk usage for paths. Returns structured size data. The text view omits the derived sizeHuman field (computable from sizeBytes); it remains in structuredContent.

**Inputs:**

- `path`: string — Path to measure
- `maxDepth`: number _(optional)_ — Depth to summarize
- `format`: "json" | "tsv" | "columnar" | "bare" _(optional)_ — Output format (default: tsv)
- `fields`: string[] _(optional)_ — Limit the text view to these columns (structuredContent keeps all)

**Outputs:**

- `entries`: object[]

## `find_files`

`read-only`

Find files by name pattern, type, or modification time. Returns structured list of paths. Use names for multiple glob patterns (OR logic), modifiedWithin for recent files (e.g. '7d', '1h').

**Inputs:**

- `path`: string — Root directory to search
- `name`: string _(optional)_ — Filename glob pattern (e.g. '*.ts')
- `names`: string[] _(optional)_ — Multiple filename glob patterns (e.g. ['*.ts', '*.py', '*.sh']). Combined with OR logic.
- `type`: "file" | "dir" | "link" _(optional)_ — Filter by type
- `maxDepth`: number _(optional)_ — Max search depth
- `modifiedWithin`: string _(optional)_ — Modified within timespan (e.g. '7d', '1h')
- `withMetadata`: boolean _(optional)_ — Include size (bytes) and mtime (unix timestamp) for each file
- `format`: "json" | "tsv" | "columnar" _(optional)_ — Output format (default: tsv)

**Outputs:**

- `files`: string[]
- `count`: number
- `metadata`: object[] _(optional)_

## `git_branches`

`read-only`

List git branches with current branch marker and last commit info.

**Inputs:**

- `cwd`: string _(optional)_ — Repository path
- `remote`: boolean _(optional)_ — Include remote branches
- `format`: "json" | "tsv" | "columnar" | "bare" _(optional)_ — Output format (default: tsv)
- `fields`: string[] _(optional)_ — Limit the text view to these columns (structuredContent keeps all)

**Outputs:**

- `current`: string
- `branches`: object[]

## `git_diff`

`read-only`

Structured git diff: files changed with insertions/deletions counts. Use base+ref for two-ref comparison (e.g. base='main', ref='feature'). Use path to scope to a specific file or directory.

**Inputs:**

- `cwd`: string _(optional)_ — Repository path
- `ref`: string _(optional)_ — Ref to diff against (e.g. 'main', 'HEAD~3')
- `base`: string _(optional)_ — Base ref for two-ref comparison. When both ref and base are set, runs git diff <base> <ref>
- `staged`: boolean _(optional)_ — Show staged changes
- `path`: string _(optional)_ — Limit diff to a specific file or directory

**Outputs:**

- `files`: object[]
- `totalInsertions`: number
- `totalDeletions`: number
- `fileCount`: number

## `git_diff_content`

`read-only`

Show git diff with structured patch content. Returns parsed hunks per file instead of raw unified diff text. Use this when you need to see actual code changes, not just file-level stats. Use base+ref for two-ref comparison (e.g. base='main', ref='feature').

**Inputs:**

- `cwd`: string _(optional)_ — Working directory (git repo)
- `ref`: string _(optional)_ — Diff against this ref (e.g. 'HEAD~1', 'main', a commit hash)
- `base`: string _(optional)_ — Base ref for two-ref comparison. When both ref and base are set, runs git diff <base> <ref>
- `staged`: boolean _(optional)_ — Show staged changes (--cached)
- `path`: string _(optional)_ — Limit diff to a specific file or directory
- `context`: number _(optional)_ — Number of context lines around changes (passed as -U<n>)

**Outputs:**

- `files`: object[]
- `summary`: object

## `git_log`

`read-only`

Structured git log: commit hash, author, date, message. Compact and parseable. Use range for ref comparisons (e.g. 'main..feature'). Use exclude to filter out commits matching a pattern (e.g. 'ci:').

**Inputs:**

- `cwd`: string _(optional)_ — Repository path
- `count`: number _(optional)_ — Number of commits (default 20)
- `author`: string _(optional)_ — Filter by author
- `since`: string _(optional)_ — Since date (e.g. '2024-01-01')
- `path`: string _(optional)_ — Filter by file path
- `range`: string _(optional)_ — Git ref range (e.g. 'main..feature', 'HEAD~5..HEAD')
- `exclude`: string _(optional)_ — Exclude commits matching this grep pattern (uses --invert-grep)
- `withFiles`: boolean _(optional)_ — Include list of files changed per commit
- `format`: "json" | "tsv" | "columnar" | "bare" _(optional)_ — Output format (default: tsv)
- `fields`: string[] _(optional)_ — Limit the text view to these columns, e.g. ['shortHash','message'] (structuredContent keeps all)

**Outputs:**

- `commits`: object[]
- `count`: number

## `git_pr_context`

`read-only`

Collect the commits and file changes of a branch vs a base ref (for writing a PR description): commit list, changed files with status, and a diffstat over base...head.

**Inputs:**

- `cwd`: string _(optional)_ — Repository path
- `base`: string _(optional)_ — Base ref to compare against (default 'main')
- `head`: string _(optional)_ — Head ref (default 'HEAD')

**Outputs:**

- `base`: string
- `head`: string
- `commits`: object[]
- `files`: object[]
- `changes`: object

**Equivalent commands:**

```sh
git log <base>..<head>
git diff --name-status <base>...<head>
git diff --stat <base>...<head>
```

## `git_status`

`read-only`

Structured git status: branch, staged/unstaged/untracked files. Replaces parsing raw git status output.

**Inputs:**

- `cwd`: string _(optional)_ — Repository path

**Outputs:**

- `branch`: string
- `ahead`: number
- `behind`: number
- `staged`: object[]
- `unstaged`: object[]
- `untracked`: string[]
- `clean`: boolean

## `glob`

`read-only`

Find files matching a glob pattern. Returns a compact list of paths.

**Inputs:**

- `pattern`: string — Glob pattern (e.g. 'src/**/*.ts')
- `cwd`: string _(optional)_ — Working directory for the glob
- `format`: "json" | "tsv" | "columnar" _(optional)_ — Output format (default: tsv)

**Outputs:**

- `files`: string[]
- `count`: number

## `helm_list`

`read-only`

List Helm releases with status, chart, and app version. Structured output.

**Inputs:**

- `namespace`: string _(optional)_ — Namespace (omit for all)
- `allNamespaces`: boolean _(optional)_ — All namespaces
- `filter`: string _(optional)_ — Filter by release name regex
- `context`: string _(optional)_ — Kubectl context

**Outputs:**

- `releases`: object[]
- `count`: number

## `helm_release_triage`

`read-only`

Diagnose a Helm release's health in one call: combines helm status + helm history into current status, likely causes, suggested next commands, and recent-revision evidence.

**Inputs:**

- `release`: string — Release name
- `namespace`: string _(optional)_ — Namespace
- `context`: string _(optional)_ — Kubectl context

**Outputs:**

- `status`: string
- `healthy`: boolean
- `revision`: number
- `revisions`: number
- `likelyCauses`: string[]
- `suggestedNextCommands`: string[]
- `evidence`: string[]

**Equivalent commands:**

```sh
helm status <release> -n <ns>
helm history <release> -n <ns>
```

## `helm_status`

`read-only`

Get detailed status of a Helm release.

**Inputs:**

- `release`: string — Release name
- `namespace`: string _(optional)_ — Namespace
- `context`: string _(optional)_ — Kubectl context

**Outputs:**

- `name`: string
- `namespace`: string
- `revision`: number
- `status`: string
- `description`: string
- `lastDeployed`: string
- `notes`: string

## `helm_values`

`read-only`

Get the computed values for a Helm release as structured data.

**Inputs:**

- `release`: string — Release name
- `namespace`: string _(optional)_ — Namespace
- `allValues`: boolean _(optional)_ — Include chart defaults (not just user-supplied)
- `context`: string _(optional)_ — Kubectl context

**Outputs:**

- `values`: object

## `jq`

`read-only`

Query and transform JSON using jq expressions. Accepts a file path or raw JSON string. Returns parsed, structured output — far more compact than reading a full JSON file. The filter is passed directly to jq (no shell), so shell-style escaping such as backslash-escaped quotes is neither needed nor supported — write the filter exactly as jq expects it.

**Inputs:**

- `filter`: string _(optional)_ — jq filter expression (default: '.')
- `file`: string _(optional)_ — Path to a JSON file
- `input`: string _(optional)_ — Raw JSON string to process (alternative to file)
- `rawOutput`: boolean _(optional)_ — Output raw strings without JSON encoding (-r)
- `slurp`: boolean _(optional)_ — Read entire input into array (-s)
- `compact`: boolean _(optional)_ — Compact output (-c)

**Outputs:**

- `result`: object | unknown[] | string | number | boolean | unknown
- `multiline`: boolean

## `kube_contexts`

`read-only`

List available kubectl contexts with current context marked.

**Inputs:**

- `format`: "json" | "tsv" | "columnar" | "bare" _(optional)_ — Output format (default: tsv)
- `fields`: string[] _(optional)_ — Limit the text view to these columns (structuredContent keeps all)

**Outputs:**

- `current`: string
- `contexts`: object[]

## `kube_deployment_status`

`read-only`

Report a deployment's rollout health (ready/desired replicas, conditions) as a structured diagnosis.

**Inputs:**

- `name`: string — Deployment name
- `namespace`: string _(optional)_ — Namespace
- `context`: string _(optional)_ — Kubectl context

**Outputs:**

- `status`: string
- `likelyCauses`: string[]
- `suggestedNextCommands`: string[]
- `evidence`: string[]

**Equivalent commands:**

```sh
kubectl rollout status deployment/<name> -n <ns>
kubectl get deployment <name> -n <ns> -o json
```

## `kube_diagnose_pod`

`read-only`

Diagnose why a pod is unhealthy in one call. Returns status, likely causes, suggested next commands, and evidence (CrashLoopBackOff/ImagePullBackOff/OOMKilled/Unschedulable/restarts).

**Inputs:**

- `pod`: string — Pod name
- `namespace`: string _(optional)_ — Namespace
- `context`: string _(optional)_ — Kubectl context

**Outputs:**

- `status`: string
- `likelyCauses`: string[]
- `suggestedNextCommands`: string[]
- `evidence`: string[]

**Equivalent commands:**

```sh
kubectl get pod <pod> -n <ns> -o json
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -n <ns>
```

## `kube_events_summary`

`read-only`

Summarize Warning events in a namespace (grouped by reason, ordered by count) instead of scrolling raw kubectl get events.

**Inputs:**

- `namespace`: string _(optional)_ — Namespace
- `allNamespaces`: boolean _(optional)_ — Search all namespaces
- `context`: string _(optional)_ — Kubectl context

**Outputs:**

- `status`: string
- `likelyCauses`: string[]
- `suggestedNextCommands`: string[]
- `evidence`: string[]

## `kube_get`

`read-only`

Get Kubernetes resources as structured data. Wraps kubectl get -o json and returns a compact summary by default. Use the jq param to extract specific fields from the raw JSON (e.g. '.spec.template.spec.containers[].env') instead of the summary.

**Inputs:**

- `resource`: string — Resource type (e.g. pods, deployments, services, nodes)
- `namespace`: string _(optional)_ — Namespace (omit for all-namespaces or cluster-scoped)
- `allNamespaces`: boolean _(optional)_ — Search all namespaces
- `selector`: string _(optional)_ — Label selector (e.g. 'app=nginx')
- `name`: string _(optional)_ — Specific resource name
- `context`: string _(optional)_ — Kubectl context to use
- `jq`: string _(optional)_ — jq filter applied to raw kubectl JSON. Skips the default summary and returns the jq result instead. Example: '.spec.template.spec.containers[].env'
- `format`: "json" | "tsv" | "columnar" | "bare" _(optional)_ — Output format for the item list (default: tsv)
- `fields`: string[] _(optional)_ — Limit the text view to these columns, e.g. ['name','status','restarts'] (structuredContent keeps all)
- `detailLevel`: "summary" | "normal" | "full" _(optional)_ — Output size preset: summary (~20 items), normal (~100), full (uncapped, default).
- `maxItems`: number _(optional)_ — Explicit cap on returned items; overrides detailLevel.
- `includeRaw`: boolean _(optional)_ — Include raw/verbose fields where supported.

**Outputs:**

_no structured output_

**Equivalent commands:**

```sh
kubectl get <resource> -o json
```

## `kube_logs`

`read-only`

Get pod logs. Returns structured log lines with timestamps when available. Use grep to filter lines by regex pattern (e.g. 'ERROR|WARN') instead of piping through shell commands.

**Inputs:**

- `pod`: string — Pod name (or deployment/xxx)
- `namespace`: string _(optional)_ — Namespace
- `container`: string _(optional)_ — Container name
- `tail`: number _(optional)_ — Number of lines (default 100)
- `since`: string _(optional)_ — Duration like '1h', '30m'
- `grep`: string _(optional)_ — Regex pattern to filter log lines (e.g. 'ERROR|WARN', 'timeout'). Only matching lines are returned.
- `ignoreCase`: boolean _(optional)_ — Case-insensitive grep matching (default: false)
- `context`: string _(optional)_ — Kubectl context
- `detailLevel`: "summary" | "normal" | "full" _(optional)_ — Output size preset: summary (~20 items), normal (~100), full (uncapped, default).
- `maxItems`: number _(optional)_ — Explicit cap on returned items; overrides detailLevel.
- `includeRaw`: boolean _(optional)_ — Include raw/verbose fields where supported.

**Outputs:**

- `lines`: object[]
- `count`: number
- `pod`: string
- `total`: number _(optional)_
- `truncated`: boolean _(optional)_

## `kube_pod_failure_summary`

`read-only`

List unhealthy pods in a namespace with their failure reason and evidence — one call instead of get + describe per pod.

**Inputs:**

- `namespace`: string _(optional)_ — Namespace
- `allNamespaces`: boolean _(optional)_ — Search all namespaces
- `context`: string _(optional)_ — Kubectl context

**Outputs:**

- `status`: string
- `likelyCauses`: string[]
- `suggestedNextCommands`: string[]
- `evidence`: string[]
- `pods`: object[]

**Equivalent commands:**

```sh
kubectl get pods -n <ns> -o json
kubectl describe pod <pod> -n <ns>
```

## `liquibase_status`

`read-only`

List Liquibase changesets not yet applied to the target database, as structured JSON. Reports up-to-date vs a pending list. liquibase is on PATH — no mise/wrapper needed.

**Inputs:**

- `cwd`: string _(optional)_ — Directory to run liquibase in (where the defaults file / changelog live).
- `defaultsFile`: string _(optional)_ — Path to the Liquibase defaults file (--defaults-file), e.g. db-dev.properties. Usually carries the JDBC URL, credentials, and changelog path.
- `changelogFile`: string _(optional)_ — Changelog path (--changelog-file); usually set in the defaults file instead.
- `labels`: string _(optional)_ — Label expression to filter changesets (--labels).
- `contexts`: string _(optional)_ — Context expression to filter changesets (--contexts).
- `extraArgs`: string[] _(optional)_ — Additional raw arguments appended to the liquibase invocation.

**Outputs:**

- `upToDate`: boolean
- `pendingCount`: number
- `pending`: object[]

**Equivalent commands:**

```sh
liquibase status --verbose
```

## `liquibase_update_sql`

`read-only`

Render the SQL Liquibase would run for pending changesets (updateSQL) as structured per-changeset summaries with a SQL-Server batch lint. Does NOT apply changes. SQL bodies are omitted unless includeRaw or changesetId is set. liquibase is on PATH — no mise/wrapper needed.

**Inputs:**

- `cwd`: string _(optional)_ — Directory to run liquibase in (where the defaults file / changelog live).
- `defaultsFile`: string _(optional)_ — Path to the Liquibase defaults file (--defaults-file), e.g. db-dev.properties. Usually carries the JDBC URL, credentials, and changelog path.
- `changelogFile`: string _(optional)_ — Changelog path (--changelog-file); usually set in the defaults file instead.
- `labels`: string _(optional)_ — Label expression to filter changesets (--labels).
- `contexts`: string _(optional)_ — Context expression to filter changesets (--contexts).
- `extraArgs`: string[] _(optional)_ — Additional raw arguments appended to the liquibase invocation.
- `changesetId`: string _(optional)_ — Return only this changeset's full rendered SQL (matches the changeset id).
- `batchLint`: boolean _(optional)_ — Lint each changeset for the SQL-Server 'routine DDL must lead its GO-batch' rule (default true).
- `detailLevel`: "summary" | "normal" | "full" _(optional)_ — Output size preset: summary (~20 items), normal (~100), full (uncapped, default).
- `maxItems`: number _(optional)_ — Explicit cap on returned items; overrides detailLevel.
- `includeRaw`: boolean _(optional)_ — Include raw/verbose fields where supported.

**Outputs:**

- `changesetCount`: number
- `changesets`: object[]
- `total`: number _(optional)_
- `truncated`: boolean _(optional)_

**Equivalent commands:**

```sh
liquibase updateSQL
```

## `liquibase_validate`

`read-only`

Validate a Liquibase changelog and return a structured pass/fail result with per-changeset errors (duplicate ids, checksum drift). Much more compact than raw output. liquibase is on PATH — no mise/wrapper needed.

**Inputs:**

- `cwd`: string _(optional)_ — Directory to run liquibase in (where the defaults file / changelog live).
- `defaultsFile`: string _(optional)_ — Path to the Liquibase defaults file (--defaults-file), e.g. db-dev.properties. Usually carries the JDBC URL, credentials, and changelog path.
- `changelogFile`: string _(optional)_ — Changelog path (--changelog-file); usually set in the defaults file instead.
- `labels`: string _(optional)_ — Label expression to filter changesets (--labels).
- `contexts`: string _(optional)_ — Context expression to filter changesets (--contexts).
- `extraArgs`: string[] _(optional)_ — Additional raw arguments appended to the liquibase invocation.

**Outputs:**

- `valid`: boolean
- `errorCount`: number
- `errors`: object[]

**Equivalent commands:**

```sh
liquibase validate
```

## `list_guidance`

`read-only`

Return an intent → preferred-tool index so you can pick the right bash-mcp tool for a goal. Each entry names the tool to prefer, raw-command anti-patterns to avoid, and why. Filter with `intent` (substring) or `category` to narrow the list.

**Inputs:**

- `intent`: string _(optional)_ — Case-insensitive substring filter on the intent text.
- `category`: string _(optional)_ — Exact category filter, e.g. 'kubernetes', 'git', 'terraform'.

**Outputs:**

- `intents`: object[]
- `total`: number

## `ls`

`read-only`

List files in a directory. Returns structured entries with name, type, size, and permissions. Much more compact than raw ls output. Use recursive for one level of subdirectories. Use all to include hidden files.

**Inputs:**

- `path`: string — Directory path to list
- `all`: boolean _(optional)_ — Include hidden files
- `recursive`: boolean _(optional)_ — Recurse into subdirectories (1 level)
- `nameOnly`: boolean _(optional)_ — Only return names and types (omit size, permissions, modified)
- `format`: "json" | "tsv" | "columnar" | "bare" _(optional)_ — Output format (default: tsv)
- `fields`: string[] _(optional)_ — Limit the text view to these columns (structuredContent keeps all)

**Outputs:**

- `entries`: object[]
- `total`: number
- `path`: string

## `npm_lint`

Run biome check and return structured diagnostics with file, line, column, message, and rule. Far more compact and parseable than raw lint output. Use minSeverity to filter by severity level.

**Inputs:**

- `cwd`: string — Project root directory
- `fix`: boolean _(optional)_ — Auto-fix safe issues (default: false)
- `paths`: string[] _(optional)_ — Specific paths to lint (default: '.')
- `minSeverity`: "error" | "warning" | "info" _(optional)_ — Minimum severity to include (e.g. 'error' drops warnings and info)

**Outputs:**

- `errors`: object[]
- `errorCount`: number
- `warningCount`: number
- `fixedCount`: number

## `npm_test`

Run vitest and return structured test results: suites, pass/fail counts, failure messages. Much more compact than raw test output. Only failures are listed by default; use verbose=true for all tests.

**Inputs:**

- `cwd`: string — Project root directory
- `pattern`: string _(optional)_ — Filter tests by filename pattern
- `coverage`: boolean _(optional)_ — Enable coverage reporting
- `verbose`: boolean _(optional)_ — Include all tests in output (default: only failures)

**Outputs:**

- `suites`: object[]
- `summary`: object

## `npm_typecheck`

`read-only`

Run tsc/tsgo --noEmit and return structured type errors with file, line, column, message, and TS error code. Much more compact than raw tsc output. Auto-detects tsgo for faster checking. Use project to specify a tsconfig.

**Inputs:**

- `cwd`: string — Project root directory
- `project`: string _(optional)_ — Path to tsconfig.json (default: auto-detected by tsc)
- `format`: "grouped" | "tsv" | "json" _(optional)_ — Text format: grouped (default, file header once then line:col rule message), tsv, or json
- `fields`: string[] _(optional)_ — Limit the text view to these columns (e.g. ['file','loc','message']); structuredContent keeps all
- `detailLevel`: "summary" | "normal" | "full" _(optional)_ — Output size preset: summary (~20 items), normal (~100), full (uncapped, default).
- `maxItems`: number _(optional)_ — Explicit cap on returned items; overrides detailLevel.

**Outputs:**

- `errors`: object[]
- `errorCount`: number
- `success`: boolean

## `outline`

`read-only`

Show the structural outline of a file — function/class names, top-level comments, imports. Returns a compact view without implementation bodies. Includes git metadata (branch, commit) when the file is in a git repo. Use instead of cat when reviewing file structure or auditing many files at once.

**Inputs:**

- `path`: string — Path to the file
- `ref`: string _(optional)_ — Git ref to outline (e.g. 'main', 'HEAD~1', a commit hash). When set, reads file content from git (git show ref:path) instead of disk.

**Outputs:**

- `path`: string
- `language`: string
- `totalLines`: number
- `outlineLines`: number
- `symbols`: number
- `mtime`: number — File modification time (unix timestamp). 0 if using ref.
- `branch`: string — Current git branch, or null if not in a git repo
- `commit`: string — Last commit hash that touched this file, or null if not in a git repo
- `outline`: string

## `python_lint`

Run ruff check and return structured diagnostics with file, line, column, message, and rule code. Much more compact than raw ruff output. Use minSeverity to filter by severity level.

**Inputs:**

- `cwd`: string — Project root directory
- `fix`: boolean _(optional)_ — Auto-fix safe issues (default: false)
- `paths`: string[] _(optional)_ — Specific paths to lint (default: '.')
- `minSeverity`: "error" | "warning" | "info" _(optional)_ — Minimum severity to include (e.g. 'error' drops warnings and info)
- `format`: "grouped" | "tsv" | "json" _(optional)_ — Text format: grouped (default, file header once then line:col rule message), tsv, or json
- `fields`: string[] _(optional)_ — Limit the text view to these columns (e.g. ['file','loc','message']); structuredContent keeps all
- `detailLevel`: "summary" | "normal" | "full" _(optional)_ — Output size preset: summary (~20 items), normal (~100), full (uncapped, default).
- `maxItems`: number _(optional)_ — Explicit cap on returned items; overrides detailLevel.

**Outputs:**

- `errors`: object[]
- `errorCount`: number
- `warningCount`: number
- `fixedCount`: number

## `python_test`

Run pytest and return structured test results: suites, pass/fail counts, failure messages. Much more compact than raw test output. Only failures are listed by default; use verbose=true for all tests.

**Inputs:**

- `cwd`: string — Project root directory
- `pattern`: string _(optional)_ — Filter tests by expression (-k pattern)
- `path`: string _(optional)_ — Specific test path or file to run
- `verbose`: boolean _(optional)_ — Include all tests in output (default: only failures)

**Outputs:**

- `suites`: object[]
- `summary`: object

## `python_typecheck`

`read-only`

Run mypy and return structured type errors with file, line, column, message, and error code. Much more compact than raw mypy output.

**Inputs:**

- `cwd`: string — Project root directory
- `paths`: string[] _(optional)_ — Specific paths to check (default: '.')
- `format`: "grouped" | "tsv" | "json" _(optional)_ — Text format: grouped (default, file header once then line:col rule message), tsv, or json
- `fields`: string[] _(optional)_ — Limit the text view to these columns (e.g. ['file','loc','message']); structuredContent keeps all
- `detailLevel`: "summary" | "normal" | "full" _(optional)_ — Output size preset: summary (~20 items), normal (~100), full (uncapped, default).
- `maxItems`: number _(optional)_ — Explicit cap on returned items; overrides detailLevel.

**Outputs:**

- `errors`: object[]
- `errorCount`: number
- `success`: boolean

## `repo_health_summary`

`read-only`

One-call snapshot of a git working tree: branch, ahead/behind vs upstream, staged/unstaged/untracked counts, recent commits, and the uncommitted diffstat.

**Inputs:**

- `cwd`: string _(optional)_ — Repository path
- `commits`: number _(optional)_ — Number of recent commits to include (default 5)

**Outputs:**

- `branch`: string
- `ahead`: number
- `behind`: number
- `staged`: number
- `unstaged`: number
- `untracked`: number
- `clean`: boolean
- `recentCommits`: object[]
- `changes`: object

**Equivalent commands:**

```sh
git status
git rev-list --left-right --count @{u}...HEAD
git log -n 5
git diff --stat
```

## `rg`

`read-only`

Search file contents with ripgrep. Returns structured matches with file, line number, and matched text. Far more compact than raw rg output. Use glob (string or array, '!' to exclude) to filter files, ignoreCase for case-insensitive search, filesOnly for just filenames, countPerFile for match counts per file, maxPerFile to cap hits per file. For 'collect all X' tasks use only:true to return just the matched substrings (one row per hit) — add replace ($1 capture groups) to extract structured values.

**Inputs:**

- `pattern`: string — Regex pattern to search for
- `path`: string _(optional)_ — Directory or file to search (default: cwd)
- `glob`: string | string[] _(optional)_ — File glob filter(s); a string or array. Prefix with '!' to exclude (e.g. ['*.ts','!*.test.ts'])
- `ignoreCase`: boolean _(optional)_ — Case-insensitive search
- `maxResults`: number _(optional)_ — Max results to return across all files (default 100)
- `maxPerFile`: number _(optional)_ — Cap matches per file (rg --max-count), independent of maxResults — keeps one hot file from dominating
- `only`: boolean _(optional)_ — Return only the matched substring(s), not the whole line — one row per match. Best for collecting tokens (versions, names, URLs)
- `replace`: string _(optional)_ — Rewrite each match with this template ($1, $2 capture groups) and return the result; implies only-match extraction
- `context`: number _(optional)_ — Lines of context around each match
- `filesOnly`: boolean _(optional)_ — Only return filenames, not matched lines
- `countPerFile`: boolean _(optional)_ — Return match counts grouped by file instead of individual matches
- `fixedStrings`: boolean _(optional)_ — Treat pattern as literal string
- `maxLineLength`: number _(optional)_ — Window matched line text to ~this many chars centered on the match, so long/minified lines don't dump in full (0 = unlimited, default 300)
- `format`: "json" | "tsv" | "columnar" | "bare" | "grouped" _(optional)_ — Output format: grouped (default for matches, file header once then line+text, ripgrep-style), tsv, json, columnar (keys once), bare (no header). filesOnly defaults to bare, countPerFile to tsv.
- `fields`: string[] _(optional)_ — Limit the text view to these columns (e.g. ['file','line']); structuredContent keeps all

**Outputs:**

- `matches`: object[]
- `fileCount`: number
- `matchCount`: number
- `truncated`: boolean
- `fileCounts`: object[] _(optional)_

## `run`

Run a shell command and return structured output with smart truncation. Keeps the last N lines of output by default (where errors typically appear), or the first N with mode='head'. Use for build, test, and lint commands where you need exit code and error details, not full verbose output.

**Inputs:**

- `command`: string — The command to run (e.g. 'npm')
- `args`: string[] _(optional)_ — Command arguments (e.g. ['test'])
- `cwd`: string _(optional)_ — Working directory
- `timeout`: number _(optional)_ — Timeout in ms
- `maxLines`: number _(optional)_ — Max stdout/stderr lines to keep. 0 = unlimited.
- `mode`: "tail" | "head" _(optional)_ — Keep the last N lines (tail, default) or the first N (head).
- `maxBytes`: number _(optional)_ — Optional cap on stdout/stderr byte length (UTF-8).

**Outputs:**

- `exitCode`: number
- `stdout`: string
- `stderr`: string
- `stdoutLines`: number
- `truncated`: boolean
- `elapsed`: number — Wall-clock execution time in milliseconds

**Equivalent commands:**

```sh
<command> | tail -n N
<command> | head -n N
```

## `run_seq`

Run an ordered list of labeled commands one after another, stopping at the first failure by default. Use for dependent steps (e.g. build then test then package) where order matters and a later step is pointless if an earlier one fails. Unlike batch (parallel), run_seq is sequential and short-circuits; set stopOnError=false to run every step regardless.

**Inputs:**

- `steps`: object[] — Ordered steps to run sequentially
- `stopOnError`: boolean _(optional)_ — Stop at the first step with a non-zero exit code (default true).
- `maxLines`: number _(optional)_ — Max stdout/stderr lines to keep per step. 0 = unlimited.

**Outputs:**

- `steps`: object[]
- `exitCode`: number — 0 if every step succeeded, else the first failure's code
- `failedAt`: number — Index of the first failing step, or null if all passed
- `elapsed`: number — Total wall-clock time in milliseconds

**Equivalent commands:**

```sh
cmd1 && cmd2 && cmd3
```

## `tf_backend_info`

`read-only`

Report the configured backend type and config for an initialized project. Reads .terraform/terraform.tfstate — run init first.

**Inputs:**

- `cwd`: string — Terraform project directory

**Outputs:**

- `type`: string
- `config`: object

## `tf_modules_summary`

`read-only`

List the modules used by an initialized Terraform/OpenTofu project (key, source, version). Reads .terraform/modules/modules.json — run init first.

**Inputs:**

- `cwd`: string — Terraform project directory

**Outputs:**

- `modules`: object[]
- `count`: number

## `tf_outputs`

`read-only`

List Terraform/OpenTofu outputs (name, type, value) with sensitive values redacted.

**Inputs:**

- `cwd`: string — Terraform project directory
- `binary`: "terraform" | "tofu" _(optional)_ — Binary to invoke (terraform or tofu). Defaults to $TF_BINARY, else terraform.
- `format`: "json" | "tsv" | "columnar" | "bare" _(optional)_ — Output format (default: tsv)
- `fields`: string[] _(optional)_ — Limit the text view to these columns (structuredContent keeps all)

**Outputs:**

- `outputs`: object[]
- `count`: number

## `tf_plan_summary`

`read-only`

Run terraform plan and return a structured summary of changes (add/change/destroy counts and affected resources).

**Inputs:**

- `cwd`: string — Terraform project directory
- `target`: string _(optional)_ — Target specific resource
- `varFile`: string _(optional)_ — Var file to use
- `planFile`: string _(optional)_ — Path to a saved plan file (from `terraform plan -out`); summarized via `show -json` instead of re-running plan.
- `binary`: "terraform" | "tofu" _(optional)_ — Binary to invoke (terraform or tofu). Defaults to $TF_BINARY, else terraform.

**Outputs:**

- `add`: number
- `change`: number
- `destroy`: number
- `changes`: object[]
- `noChanges`: boolean

**Equivalent commands:**

```sh
terraform plan -no-color
terraform show -json <planfile>
```

## `tf_providers`

`read-only`

List the Terraform/OpenTofu version and selected provider versions for the project.

**Inputs:**

- `cwd`: string — Terraform project directory
- `binary`: "terraform" | "tofu" _(optional)_ — Binary to invoke (terraform or tofu). Defaults to $TF_BINARY, else terraform.

**Outputs:**

- `version`: string
- `providers`: object[]

## `tf_show`

`read-only`

Show current Terraform state as structured JSON. Returns resource summary with types and attributes.

**Inputs:**

- `cwd`: string — Terraform project directory
- `binary`: "terraform" | "tofu" _(optional)_ — Binary to invoke (terraform or tofu). Defaults to $TF_BINARY, else terraform.

**Outputs:**

- `resources`: object[]
- `count`: number

## `tf_state_list`

`read-only`

List resources in Terraform state. Returns structured resource addresses grouped by type. Text view lists addresses only (type/name/module are parsed from each address); the byType rollup is in meta.

**Inputs:**

- `cwd`: string — Terraform project directory
- `binary`: "terraform" | "tofu" _(optional)_ — Binary to invoke (terraform or tofu). Defaults to $TF_BINARY, else terraform.
- `format`: "json" | "tsv" | "columnar" | "bare" _(optional)_ — Output format (default: bare — one address per line)

**Outputs:**

- `resources`: object[]
- `count`: number
- `byType`: object

## `tf_validate_summary`

`read-only`

Validate the Terraform/OpenTofu config and return a compact pass/fail summary with diagnostics.

**Inputs:**

- `cwd`: string — Terraform project directory
- `binary`: "terraform" | "tofu" _(optional)_ — Binary to invoke (terraform or tofu). Defaults to $TF_BINARY, else terraform.

**Outputs:**

- `valid`: boolean
- `errorCount`: number
- `warningCount`: number
- `diagnostics`: object[]

## `tf_workspaces`

`read-only`

List Terraform workspaces with current workspace marked.

**Inputs:**

- `cwd`: string — Terraform project directory
- `binary`: "terraform" | "tofu" _(optional)_ — Binary to invoke (terraform or tofu). Defaults to $TF_BINARY, else terraform.

**Outputs:**

- `current`: string
- `workspaces`: string[]

## `tree`

`read-only`

Show directory structure as a compact tree. Returns structured nodes instead of ASCII art. Use dirsOnly for directory-only view, pattern to filter by glob, maxDepth to control depth.

**Inputs:**

- `path`: string — Root directory
- `maxDepth`: number _(optional)_ — Max depth (default 3)
- `dirsOnly`: boolean _(optional)_ — Only show directories
- `pattern`: string _(optional)_ — Only show files matching glob pattern
- `exclude`: string _(optional)_ — Pipe-separated patterns to exclude (default: node_modules|.git|dist|__pycache__|.venv|.next|.terraform)
- `format`: "json" | "tsv" | "columnar" | "bare" _(optional)_ — Output format (default: bare — paths, dirs end with /)

**Outputs:**

- `dirs`: number
- `files`: number
- `tree`: object[]

## `yq`

`read-only`

Query and transform YAML files using yq expressions (mikefarah/yq). Outputs as JSON for structured consumption. Far more compact than reading a full YAML file.

**Inputs:**

- `expression`: string _(optional)_ — yq expression (default: '.')
- `file`: string _(optional)_ — Path to a YAML file
- `input`: string _(optional)_ — Raw YAML string to process (alternative to file)
- `outputFormat`: "json" | "yaml" | "props" _(optional)_ — Output format (default: 'json' for structured output)

**Outputs:**

- `result`: object | unknown[] | string | number | boolean | unknown
- `format`: string
