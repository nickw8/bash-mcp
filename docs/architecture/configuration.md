# Configuration & Runtime

Read when a tool times out, a CLI is missing, or `run`/`batch` refuses a command.

## Env Vars

- BASH_MCP_LOG: error (default, only failed calls) | info (adds successes) | off/silent. Wide-event JSON to stderr; run/batch args redacted.
- BASH_MCP_MODE: readOnly (default, blocks mutating run/batch) | confirmWrites | off (no enforcement) | dangerous. Gates run/batch mutating commands; set off for trusted local use.
- BASH_MCP_PROFILE: all (default) | core | development | infrastructure. Which tool groups register; the `profiles` column of `GROUPS` in src/registry.ts. Unknown value stops startup.
- BASH_MCP_RESPONSE_MODE: auto (default) | summary | compact | full. Response budget in src/budget.ts; see output-conventions.md "Response budget". Unknown value stops startup.
- BASH_MCP_RESULT_TTL: seconds a trimmed result stays in the result store (default 900; 0 disables the store).
- BASH_MCP_RESULT_MAX_BYTES: total bytes the store holds (default 32 MB; one result may use a quarter).
- BASH_MCP_HOOK: block (default) | warn | off. Read by hooks/bash-mcp-redirect.sh, not the server. The plugin's hooks.json defaults it to warn.
- TF_BINARY: terraform (default) | tofu. Default binary for tf_* tools.

## Timeouts (TIMEOUT constants in src/exec.ts)

DEFAULT: 30s (filesystem/search/git) | INFRA: 15s (kube/helm/argocd) | TYPECHECK: 60s (tsc, tf show) | BUILD: 120s (dotnet, npm test, tf plan) | All: 10 MB maxBuffer

Tool handlers pass these constants, never a literal.

On timeout, on a cancelled request (`notifications/cancelled`, delivered through
`callSignal`), and when the server exits, `exec` kills the child's whole process group
(POSIX): SIGTERM, then SIGKILL after 2 s. The result says `timedOut` or `cancelled`.

## Prerequisites

Node.js >= 20 always required. Per-category: rg (ripgrep), git, kubectl, terraform, helm, argocd, jq, yq (mikefarah), dotnet, liquibase, ruff, mypy, pytest, shellcheck, bats. Tools error gracefully if CLI missing.

`bash-mcp --doctor` reports Node version, dist entry, MCP SDK loadability, PATH, per-CLI
availability, and the resolved BASH_MCP_MODE.
