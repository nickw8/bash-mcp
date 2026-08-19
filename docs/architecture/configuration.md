# Configuration & Runtime

Read when a tool times out, a CLI is missing, or `run`/`batch` refuses a command.

## Env Vars

- BASH_MCP_LOG: error (default, only failed calls) | info (adds successes) | off/silent. Wide-event JSON to stderr; run/batch args redacted.
- BASH_MCP_MODE: readOnly (default, blocks mutating run/batch) | confirmWrites | off (no enforcement) | dangerous. Gates run/batch mutating commands; set off for trusted local use.
- TF_BINARY: terraform (default) | tofu. Default binary for tf_* tools.

## Timeouts (TIMEOUT constants in src/exec.ts)

DEFAULT: 30s (filesystem/search/git) | INFRA: 15s (kube/helm/argocd) | TYPECHECK: 60s (tsc, tf show) | BUILD: 120s (dotnet, npm test, tf plan) | All: 10 MB maxBuffer

Tool handlers pass these constants, never a literal.

## Prerequisites

Node.js >= 20 always required. Per-category: rg (ripgrep), git, kubectl, terraform, helm, argocd, jq, yq (mikefarah), dotnet, liquibase, ruff, mypy, pytest, shellcheck, bats. Tools error gracefully if CLI missing.

`bash-mcp --doctor` reports Node version, dist entry, MCP SDK loadability, PATH, per-CLI
availability, and the resolved BASH_MCP_MODE.
