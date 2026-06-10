# bash-mcp

An MCP server that wraps common CLI tools (kubectl, terraform, helm, git, argocd, jq, yq, ripgrep, etc.) and returns structured JSON instead of raw text output.

Designed for AI agents and LLM-powered workflows where parsing human-readable CLI output wastes tokens and breaks easily.

Created with the help of Claude since it is the main consumer of the structured data.

## Quick Start

### Option 1: Zero-install with npx

No installation needed — just add the MCP config and `npx` will fetch it on first use.

### Option 2: Global install

```bash
npm install -g @nickw8/bash-mcp
```

### Option 3: Install from source

```bash
git clone https://github.com/nickw8/bash-mcp.git
cd bash-mcp
npm install && npm run build
npm link
```

## Verify your setup

Run the built-in preflight check before wiring bash-mcp into a client:

```bash
npx -y @nickw8/bash-mcp --doctor   # or: bash-mcp --doctor (global install)
```

It reports your Node version, whether the MCP SDK loads, which CLIs are
available (versions included), and the resolved `BASH_MCP_MODE` — then exits
non-zero if a critical check fails (Node too old or the SDK can't load). Missing
CLIs are advisory, not failures. Without `--doctor`, the binary starts the MCP
server as usual.

## Claude Code Setup

Add bash-mcp to your Claude Code settings. For **all projects** (recommended), edit `~/.claude/settings.json`. For a **single project**, edit `.claude/settings.json` in the project root.

**With npx** (no install required):

```json
{
  "mcpServers": {
    "bash-mcp": {
      "command": "npx",
      "args": ["-y", "@nickw8/bash-mcp"],
      "env": {
        "BASH_MCP_MODE": "readOnly"
      }
    }
  }
}
```

> **Safe by default:** an unset `BASH_MCP_MODE` resolves to `readOnly`, which
> blocks mutating `run`/`batch` commands. The examples set it explicitly for
> clarity. For trusted local use, set `BASH_MCP_MODE=off` to allow writes.

**With global install**:

```json
{
  "mcpServers": {
    "bash-mcp": {
      "command": "bash-mcp",
      "env": {
        "BASH_MCP_MODE": "readOnly"
      }
    }
  }
}
```

To verify it's working, start Claude Code and check that bash-mcp tools (like `cat`, `rg`, `git_status`) appear in the tool list.

You can also add it from the CLI:

```bash
claude mcp add bash-mcp -e BASH_MCP_MODE=readOnly -- npx -y @nickw8/bash-mcp
```

## Claude Desktop Setup

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`,
Windows: `%APPDATA%\Claude\`) and add the same `mcpServers` entry:

```json
{
  "mcpServers": {
    "bash-mcp": {
      "command": "npx",
      "args": ["-y", "@nickw8/bash-mcp"],
      "env": {
        "BASH_MCP_MODE": "readOnly"
      }
    }
  }
}
```

Restart Claude Desktop after editing.

## Cursor Setup

Add bash-mcp to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project):

```json
{
  "mcpServers": {
    "bash-mcp": {
      "command": "npx",
      "args": ["-y", "@nickw8/bash-mcp"],
      "env": {
        "BASH_MCP_MODE": "readOnly"
      }
    }
  }
}
```

(Use `"command": "bash-mcp"` with no args if you installed globally.) Any MCP-aware
client works the same way — point it at the `bash-mcp` binary or `npx -y @nickw8/bash-mcp`.

## Recommended Hooks

Optional Claude Code hooks in [`hooks/`](hooks) steer agents toward the structured tools by blocking raw shell commands (`git status`, `kubectl get`, `cat`, …) that have a bash-mcp equivalent, while letting write commands (`git commit`, `kubectl apply`) pass through.

See [docs/recommended-hooks-setup.md](docs/recommended-hooks-setup.md) for setup.

## Why Structured Output?

Raw CLI tools return text meant for humans. AI agents waste tokens parsing tables, aligning columns, and guessing field boundaries. bash-mcp runs the same CLI tools but returns structured JSON with typed schemas, so the agent gets exactly the data it needs.

```
# Raw kubectl output: 148 tokens to parse a table
NAME                     READY   STATUS    RESTARTS   AGE
nginx-7c5b8d6c88-abc12  1/1     Running   0          3d

# bash-mcp output: typed, compact, ready to use
{ "name": "nginx-7c5b8d6c88-abc12", "status": "Running", "age": "3d", ... }
```

See [docs/token-benchmarks.md](docs/token-benchmarks.md) for measured savings (e.g.
`kubectl describe pod` → `kube_diagnose_pod` is ~64% fewer tokens).

## Philosophy: structured tools first, `run` is the escape hatch

1. **Reach for a structured tool first.** Every wrapper returns typed JSON the agent can
   use directly — no column-counting, no re-parsing on a format change.
2. **Prefer a diagnostic over a chain of raw commands.** Tools like `kube_diagnose_pod`,
   `helm_release_triage`, and `argo_app_health_summary` answer an *operational question*
   in one call — `{ status, likelyCauses, suggestedNextCommands, evidence }` — instead of
   making the agent run `get`, then `logs`, then reason across both.
3. **`run` / `batch` are the escape hatch.** For commands without a dedicated wrapper,
   `run` executes anything with smart truncation. Optional [hooks](hooks) actively steer
   agents back to the structured tool when a raw equivalent is invoked.

Read-only tools carry the MCP `readOnlyHint` annotation. `run`/`batch` can be gated with
`BASH_MCP_MODE` (see [Configuration](#configuration)).

## Which tool should I use?

Pick the structured tool that matches your intent instead of reaching for a raw command.
The `list_guidance` tool returns this same index as JSON (filter by `intent` or `category`),
so agents can self-select without the README.

<!-- BEGIN GENERATED: which-tool -->

| I want to… | Use this | Instead of |
|------------|----------|------------|
| diagnose a crashing or failing Kubernetes pod | `kube_diagnose_pod` | `kubectl describe pod`, `kubectl logs` |
| find all not-ready or failing pods in a namespace | `kube_pod_failure_summary` | `kubectl get pods`, `kubectl get pods \| grep` |
| check a deployment's rollout health | `kube_deployment_status` | `kubectl rollout status`, `kubectl get deployment` |
| understand recent cluster events | `kube_events_summary` | `kubectl get events` |
| summarize the changes in a Terraform plan | `tf_plan_summary` | `terraform plan`, `terraform show` |
| review the current feature branch before a PR | `git_pr_context` | `git diff`, `git log`, `git status` |
| understand the overall state of a repository | `repo_health_summary` | `git status`, `git log --oneline` |
| read a file's structure without loading the full body | `outline` | `cat (entire file)`, `cat` |
| search for exact code references or symbols | `rg` | `grep -r`, `rg` |
| triage why a Helm release is unhealthy | `helm_release_triage` | `helm status`, `helm get values` |
| check whether an ArgoCD app is healthy and in sync | `argo_app_health_summary` | `argocd app get`, `argocd app list` |
| validate a Liquibase changelog for errors | `liquibase_validate` | `liquibase validate` |
| preview the SQL Liquibase would run for pending changesets | `liquibase_update_sql` | `liquibase updateSQL`, `liquibase updateSQL \| grep` |
| list Liquibase changesets not yet applied to the database | `liquibase_status` | `liquibase status --verbose` |
| lint a shell script for bugs and quoting issues | `bash_lint` | `shellcheck`, `shellcheck -f json1` |
| run a bats or shell test suite | `bash_test` | `bats`, `bash test.sh` |
| discover which CLIs are installed before calling a tool | `check_environment` | `which`, `<tool> --version` |

<!-- END GENERATED: which-tool -->

## Tools

> 📖 **[Full tool reference → `docs/tools.md`](docs/tools.md)** — generated from the
> registered tools (inputs, outputs, and the raw command each one approximates).
> Regenerate with `npm run docs:tools`.

<!-- BEGIN GENERATED: tools -->

### Environment

| Tool | Description |
|------|-------------|
| `check_environment` | Report which CLIs are installed (and their versions) so you can pick the right tool before calling it. |
| `list_guidance` | Return an intent → preferred-tool index so you can pick the right bash-mcp tool for a goal. |

### Filesystem

| Tool | Description |
|------|-------------|
| `ls` | List files in a directory. |
| `tree` | Show directory structure as a compact tree. |
| `du` | Show disk usage for paths. |
| `find_files` | Find files by name pattern, type, or modification time. |

### Search

| Tool | Description |
|------|-------------|
| `rg` | Search file contents with ripgrep. |
| `glob` | Find files matching a glob pattern. |

### File

| Tool | Description |
|------|-------------|
| `cat` | Read one or more files with line numbers and smart truncation. |
| `outline` | Show the structural outline of a file — function/class names, top-level comments, imports. |

### Git

| Tool | Description |
|------|-------------|
| `git_status` | Structured git status: branch, staged/unstaged/untracked files. |
| `git_log` | Structured git log: commit hash, author, date, message. |
| `git_diff` | Structured git diff: files changed with insertions/deletions counts. |
| `git_branches` | List git branches with current branch marker and last commit info. |
| `repo_health_summary` | One-call snapshot of a git working tree: branch, ahead/behind vs upstream, staged/unstaged/untracked counts, recent commits, and the uncommitted diffstat. |
| `git_pr_context` | Collect the commits and file changes of a branch vs a base ref (for writing a PR description): commit list, changed files with status, and a diffstat over base...head. |
| `git_diff_content` | Show git diff with structured patch content. |

### Kubernetes

| Tool | Description |
|------|-------------|
| `kube_get` | Get Kubernetes resources as structured data. |
| `kube_logs` | Get pod logs. |
| `kube_contexts` | List available kubectl contexts with current context marked. |
| `kube_diagnose_pod` | Diagnose why a pod is unhealthy in one call. |
| `kube_pod_failure_summary` | List unhealthy pods in a namespace with their failure reason and evidence — one call instead of get + describe per pod. |
| `kube_deployment_status` | Report a deployment's rollout health (ready/desired replicas, conditions) as a structured diagnosis. |
| `kube_events_summary` | Summarize Warning events in a namespace (grouped by reason, ordered by count) instead of scrolling raw kubectl get events. |

### Terraform

| Tool | Description |
|------|-------------|
| `tf_state_list` | List resources in Terraform state. |
| `tf_show` | Show current Terraform state as structured JSON. |
| `tf_plan_summary` | Run terraform plan and return a structured summary of changes (add/change/destroy counts and affected resources). |
| `tf_workspaces` | List Terraform workspaces with current workspace marked. |
| `tf_outputs` | List Terraform/OpenTofu outputs (name, type, value) with sensitive values redacted. |
| `tf_providers` | List the Terraform/OpenTofu version and selected provider versions for the project. |
| `tf_validate_summary` | Validate the Terraform/OpenTofu config and return a compact pass/fail summary with diagnostics. |
| `tf_modules_summary` | List the modules used by an initialized Terraform/OpenTofu project (key, source, version). |
| `tf_backend_info` | Report the configured backend type and config for an initialized project. |

### Helm

| Tool | Description |
|------|-------------|
| `helm_list` | List Helm releases with status, chart, and app version. |
| `helm_status` | Get detailed status of a Helm release. |
| `helm_values` | Get the computed values for a Helm release as structured data. |
| `helm_release_triage` | Diagnose a Helm release's health in one call: combines helm status + helm history into current status, likely causes, suggested next commands, and recent-revision evidence. |

### ArgoCD

| Tool | Description |
|------|-------------|
| `argo_apps` | List ArgoCD applications with sync/health status. |
| `argo_app_detail` | Get detailed status for a single ArgoCD application including resource health. |
| `argo_app_diff` | Show what's out of sync for an ArgoCD application. |
| `argo_app_health_summary` | Diagnose an ArgoCD application's health in one call: overall sync/health, likely causes, suggested next commands, and the unhealthy resources/conditions as evidence. |

### Data Processing

| Tool | Description |
|------|-------------|
| `jq` | Query and transform JSON using jq expressions. |
| `yq` | Query and transform YAML files using yq expressions (mikefarah/yq). |

### .NET

| Tool | Description |
|------|-------------|
| `dotnet_build` | Run dotnet build and return structured diagnostics with file, line, column, message, and error code. |
| `dotnet_test` | Run dotnet test and return structured results: pass/fail/skip counts, failure messages. |

### Liquibase

| Tool | Description |
|------|-------------|
| `liquibase_validate` | Validate a Liquibase changelog and return a structured pass/fail result with per-changeset errors (duplicate ids, checksum drift). |
| `liquibase_update_sql` | Render the SQL Liquibase would run for pending changesets (updateSQL) as structured per-changeset summaries with a SQL-Server batch lint. |
| `liquibase_status` | List Liquibase changesets not yet applied to the target database, as structured JSON. |

### Node.js

| Tool | Description |
|------|-------------|
| `npm_lint` | Run biome check and return structured diagnostics with file, line, column, message, and rule. |
| `npm_test` | Run vitest and return structured test results: suites, pass/fail counts, failure messages. |
| `npm_typecheck` | Run tsc/tsgo --noEmit and return structured type errors with file, line, column, message, and TS error code. |

### Python

| Tool | Description |
|------|-------------|
| `python_lint` | Run ruff check and return structured diagnostics with file, line, column, message, and rule code. |
| `python_test` | Run pytest and return structured test results: suites, pass/fail counts, failure messages. |
| `python_typecheck` | Run mypy and return structured type errors with file, line, column, message, and error code. |

### Shell

| Tool | Description |
|------|-------------|
| `bash_syntax_check` | Check shell scripts for syntax errors with `bash -n` and return structured diagnostics (file, line, message). |
| `bash_lint` | Run shellcheck and return structured diagnostics with file, line, column, message, and SC rule code. |
| `bash_test` | Run a shell test script — bats `.bats` files via `--tap`, or a plain `.sh` harness — and return structured results: per-case pass/fail plus a summary parsed from TAP or `N tests, M failures` output, falling back to exit-code-only when the format is unrecognized. |

### Execution

| Tool | Description |
|------|-------------|
| `run` | Run a shell command and return structured output with smart truncation. |
| `run_seq` | Run an ordered list of labeled commands one after another, stopping at the first failure by default. |
| `batch` | Run multiple shell commands in parallel and return all results. |

<!-- END GENERATED: tools -->

All `tf_*` tools accept `binary: "terraform" | "tofu"` (or set `$TF_BINARY`) to run OpenTofu.

## Example Agent Workflows

**Triage a crash-looping pod.** Before — three raw calls plus reasoning:

```
kubectl get pods -n payments          # find the broken pod
kubectl describe pod api-xyz          # read events/state, infer cause
kubectl logs api-xyz --tail=200       # scroll for the error
# ...agent reasons across all three to guess the next step
```

After — one structured call:

```
kube_diagnose_pod(pod="api-xyz", namespace="payments")
→ { status: "CrashLoopBackOff",
    likelyCauses: ["container exits 1; DB connection refused"],
    suggestedNextCommands: ["kube_logs(pod='api-xyz', container='api')"],
    evidence: ["Restart Count: 12", "BackOff x140 over 30m"] }
```

**Review a feature branch.** Before: `git log main..HEAD`, `git diff --stat main...HEAD`,
`git diff main...HEAD` — three commands, manual stitching. After:

```
git_pr_context(base="main")
→ { commits: [...], files: [...], summary: { filesChanged, insertions, deletions } }
```

**Check capabilities before acting.** Instead of `which kubectl && kubectl config current-context`:

```
check_environment()
→ { kubectl: { installed: true, version: "1.31.2", context: "prod" },
    terraform: { installed: false }, ... }
```

## Configuration

### Environment Variables

| Variable | Values | Default | Effect |
|----------|--------|---------|--------|
| `BASH_MCP_LOG` | `error` \| `info` \| `off` | `error` | Wide-event JSON logging to **stderr** (one line per tool call). `error` logs only failed calls; `info` adds successes; `off`/`silent` disables. stdout always stays pure MCP. `run`/`batch` commands are redacted (metadata only). |
| `BASH_MCP_MODE` | `readOnly` \| `confirmWrites` \| `off` | `readOnly` | Gates `run`/`batch`. Default `readOnly` blocks commands classified as mutating (`confirmWrites` likewise). Set `off` (or `dangerous`) to disable enforcement — recommended only for trusted local use. |
| `TF_BINARY` | `terraform` \| `tofu` | `terraform` | Default binary for all `tf_*` tools (overridable per-call via `binary`). |

### Timeouts

Each tool group uses appropriate default timeouts:

- **Filesystem/search/git**: 30 seconds
- **Kubernetes/Helm/ArgoCD**: 15 seconds
- **Terraform state**: 30 seconds
- **Terraform plan**: 120 seconds
- **.NET build/test**: 120 seconds
- **Python lint**: 30 seconds
- **Python test**: 120 seconds
- **Python typecheck**: 60 seconds

### Command Buffer

All commands default to a 10 MB output buffer. Override per-tool in `src/exec.ts`.

## Development

```bash
# Install dependencies
npm install

# Run in development mode (auto-reloads)
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run tests
npm test

# Lint and format
npm run lint
npm run format
```

## Architecture

```
src/
  index.ts              # Server entry point — registers tools and starts stdio transport
  exec.ts               # Command execution layer — runs CLI tools via execFile
  tool.ts               # defineTool — wraps registerTool with wide-event logging + error catching
  error.ts              # ToolError taxonomy + classifyError (missing_binary, timeout, ...)
  logger.ts             # Zero-dep structured stderr logger (BASH_MCP_LOG)
  safety.ts             # Command classification + BASH_MCP_MODE gate for run/batch
  format.ts             # Multi-format list output (TSV, columnar, JSON)
  response.ts           # MCP response helpers (ok, okList, err)
  shell.ts              # Shell escaping utilities
  parsers/
    types.ts            # Shared interfaces: Diagnostic, TestResult, TestSuite
    schemas.ts          # Shared Zod (diagnostic, budget fragment, applyBudget)
  tools/
    argocd/argocd.ts    # argo_apps, argo_app_detail, argo_app_diff
    batch/batch.ts      # batch (parallel command execution)
    dotnet/
      dotnet.ts         # dotnet_build, dotnet_test
      parsers/          # MSBuild and TRX output parsers
    file/
      file.ts           # cat (file reading with metadata), outline (structural file outline)
      outline/          # Language-specific outline extractors
    filesystem/
      filesystem.ts     # ls, tree, du, find_files
    git/
      git.ts            # git_status, git_log, git_diff, git_branches
      diff.ts           # git_diff_content (structured patch hunks)
    helm/helm.ts        # helm_list, helm_status, helm_values
    json/json.ts        # jq
    kubernetes/
      kubernetes.ts     # kube_get, kube_logs, kube_contexts
    npm/
      npm.ts            # npm_lint, npm_test, npm_typecheck
      parsers/          # Biome, Vitest, tsc output parsers
    run/run.ts          # run (command execution with smart truncation)
    search/search.ts    # rg, glob
    terraform/
      terraform.ts      # tf_state_list, tf_show, tf_plan_summary, tf_workspaces
    yaml/yaml.ts        # yq
```

Each tool file exports a single `register*Tools(server)` function that registers all tools in its group. Every tool returns both `content` (text for display) and `structuredContent` (typed JSON for programmatic use).

## Adding a New Tool

1. Add to an existing category (`src/tools/<group>/<group>.ts`) or create a new category directory
2. Define input/output schemas with Zod (add `annotations: { readOnlyHint: true }` for read-only tools)
3. Implement the handler using `exec()` or `execJson()` from `#exec`, return `ok()` or `err()` from `#response`
4. Register it with `defineTool` from `#tool` (injects wide-event logging + uniform error catching)
5. Wire the group's `register*Tools` into `src/index.ts`
6. Add tests in a co-located `*.test.ts` file

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { exec } from "#exec";
import { ok, err } from "#response";
import { defineTool } from "#tool";

export function registerMyTools(server: McpServer) {
  defineTool(server, "my_tool", {
    title: "My tool",
    description: "What it does and why structured output helps.",
    inputSchema: {
      path: z.string().describe("Path to operate on"),
    },
    outputSchema: {
      result: z.string(),
    },
    annotations: { readOnlyHint: true },
  }, async ({ path }) => {
    const result = await exec("mytool", ["--json", path]);

    if (result.exitCode !== 0) {
      return err(result.stderr, { result: "" });
    }

    return ok({ result: result.stdout.trim() });
  });
}
```

See [docs/adding-tools.md](docs/adding-tools.md) for the full guide.

## Prerequisites

The following CLI tools must be installed for their respective tool groups to work:

- **Always required**: Node.js >= 20
- **Filesystem/search**: `ls`, `tree`, `find`, `du`, `rg` (ripgrep)
- **Git**: `git`
- **Kubernetes**: `kubectl`
- **Terraform/OpenTofu**: `terraform` or `tofu`
- **Helm**: `helm`
- **ArgoCD**: `argocd`
- **JSON**: `jq`
- **YAML**: `yq` (mikefarah/yq)
- **.NET**: `dotnet` (.NET SDK)
- **Liquibase**: `liquibase`
- **Python**: `ruff` (lint), `mypy` (typecheck), `pytest` (test)

Tools gracefully return errors if their underlying CLI is not installed.

## License

Apache-2.0
