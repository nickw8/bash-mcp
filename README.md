# bash-mcp

An MCP server that wraps common CLI tools (kubectl, terraform, helm, git, argocd, jq, yq, ripgrep, etc.) and returns structured JSON instead of raw text output.

Designed for AI agents and LLM-powered workflows where parsing human-readable CLI output wastes tokens and breaks easily.

Created with the help of Claude since it is the main consumer of the structured data.

## Quick Start

### Option 1: Zero-install with npx

No installation needed — just add the MCP config and `npx` will fetch it on first use.

### Option 2: Global install

```bash
npm install -g bash-mcp
```

### Option 3: Install from source

```bash
git clone https://github.com/nickw8/bash-mcp.git
cd bash-mcp
npm install && npm run build
npm link
```

## Claude Code Setup

Add bash-mcp to your Claude Code settings. For **all projects** (recommended), edit `~/.claude/settings.json`. For a **single project**, edit `.claude/settings.json` in the project root.

**With npx** (no install required):

```json
{
  "mcpServers": {
    "bash-mcp": {
      "command": "npx",
      "args": ["-y", "bash-mcp"]
    }
  }
}
```

**With global install**:

```json
{
  "mcpServers": {
    "bash-mcp": {
      "command": "bash-mcp"
    }
  }
}
```

To verify it's working, start Claude Code and check that bash-mcp tools (like `cat`, `rg`, `git_status`) appear in the tool list.

## Why Structured Output?

Raw CLI tools return text meant for humans. AI agents waste tokens parsing tables, aligning columns, and guessing field boundaries. bash-mcp runs the same CLI tools but returns structured JSON with typed schemas, so the agent gets exactly the data it needs.

```
# Raw kubectl output: 148 tokens to parse a table
NAME                     READY   STATUS    RESTARTS   AGE
nginx-7c5b8d6c88-abc12  1/1     Running   0          3d

# bash-mcp output: typed, compact, ready to use
{ "name": "nginx-7c5b8d6c88-abc12", "status": "Running", "age": "3d", ... }
```

## Tools

### Filesystem

| Tool | Description |
|------|-------------|
| `ls` | List directory entries with type, size, permissions |
| `tree` | Directory tree as structured nodes |
| `du` | Disk usage with human-readable sizes |
| `find_files` | Find files by name pattern, type, or modification time |

### Search

| Tool | Description |
|------|-------------|
| `rg` | Ripgrep search with structured matches (file, line, text) |
| `glob` | Find files matching a glob pattern |

### File

| Tool | Description |
|------|-------------|
| `cat` | Read file contents with line numbers, smart truncation, and metadata |
| `outline` | Structural outline of a file — function/class names, imports, constants (no bodies) |

### Git

| Tool | Description |
|------|-------------|
| `git_status` | Branch, staged/unstaged/untracked files, ahead/behind counts |
| `git_log` | Commit history with hash, author, date, message |
| `git_diff` | Diff summary with per-file insertion/deletion counts |
| `git_diff_content` | Structured diff with parsed hunks per file (actual code changes) |
| `git_branches` | Branch list with current marker and last commit |

### Kubernetes

| Tool | Description |
|------|-------------|
| `kube_get` | Get resources as structured summaries (pods, deployments, etc.) |
| `kube_logs` | Pod logs with parsed timestamps |
| `kube_contexts` | List kubectl contexts with current marker |

### Terraform

| Tool | Description |
|------|-------------|
| `tf_state_list` | Resources in state, grouped by type |
| `tf_show` | Current state as structured resource summaries |
| `tf_plan_summary` | Plan output as add/change/destroy counts with affected resources |
| `tf_workspaces` | Workspace list with current marker |

### Helm

| Tool | Description |
|------|-------------|
| `helm_list` | Releases with status, chart version, app version |
| `helm_status` | Detailed release status |
| `helm_values` | Computed values for a release |

### ArgoCD

| Tool | Description |
|------|-------------|
| `argo_apps` | Applications with sync/health status and summary counts |
| `argo_app_detail` | Detailed app status including resource health |
| `argo_app_diff` | What's out of sync for an application |

### Data Processing

| Tool | Description |
|------|-------------|
| `jq` | Query/transform JSON files or strings with jq expressions |
| `yq` | Query/transform YAML files or strings with yq expressions |

### .NET

| Tool | Description |
|------|-------------|
| `dotnet_build` | Structured MSBuild diagnostics with file, line, column, error code |
| `dotnet_test` | Structured test results via TRX parsing — only failures listed |

### Node.js

| Tool | Description |
|------|-------------|
| `npm_lint` | Structured Biome lint diagnostics |
| `npm_test` | Structured Vitest results with pass/fail counts |
| `npm_typecheck` | Structured tsc/tsgo type errors |

### Execution

| Tool | Description |
|------|-------------|
| `run` | Run a command with smart output truncation (keeps last N lines) |
| `batch` | Run multiple commands in parallel, return all results |

## Configuration

### Timeouts

Each tool group uses appropriate default timeouts:

- **Filesystem/search/git**: 30 seconds
- **Kubernetes/Helm/ArgoCD**: 15 seconds
- **Terraform state**: 30 seconds
- **Terraform plan**: 120 seconds
- **.NET build/test**: 120 seconds

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
  format.ts             # Multi-format list output (TSV, columnar, JSON)
  response.ts           # MCP response helpers (ok, okList, err)
  shell.ts              # Shell escaping utilities
  parsers/
    types.ts            # Shared interfaces: Diagnostic, TestResult, TestSuite
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
2. Define input/output schemas with Zod
3. Implement the handler using `exec()` or `execJson()` from `#exec`, return `ok()` or `err()` from `#response`
4. Register it in `src/index.ts`
5. Add tests in a co-located `*.test.ts` file

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { exec } from "#exec";
import { ok, err } from "#response";

export function registerMyTools(server: McpServer) {
  server.registerTool("my_tool", {
    title: "My tool",
    description: "What it does and why structured output helps.",
    inputSchema: {
      path: z.string().describe("Path to operate on"),
    },
    outputSchema: {
      result: z.string(),
    },
  }, async ({ path }) => {
    const result = await exec("mytool", ["--json", path]);

    if (result.exitCode !== 0) {
      return err(result.stderr, { result: "" });
    }

    return ok({ result: result.stdout.trim() });
  });
}
```

## Prerequisites

The following CLI tools must be installed for their respective tool groups to work:

- **Always required**: Node.js >= 20
- **Filesystem/search**: `ls`, `tree`, `find`, `du`, `rg` (ripgrep)
- **Git**: `git`
- **Kubernetes**: `kubectl`
- **Terraform**: `terraform`
- **Helm**: `helm`
- **ArgoCD**: `argocd`
- **JSON**: `jq`
- **YAML**: `yq` (mikefarah/yq)
- **.NET**: `dotnet` (.NET SDK)

Tools gracefully return errors if their underlying CLI is not installed.

## License

Apache-2.0
