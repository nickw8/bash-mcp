# Tool discovery: profiles and tool search

Read when the tool list costs too much context, or a client caps how many tools it takes.

Every tool definition a client loads costs context before the first call. bash-mcp has
two answers: list fewer tools (profiles), or let the client load definitions on demand
(tool search). They combine.

## Profiles

`BASH_MCP_PROFILE` picks which tool groups register. The `profiles` column of `GROUPS`
in `src/registry.ts` is the source of truth.

| Profile | Groups | Tools | Wire tokens | Model tokens |
|---|---|---:|---:|---:|
| `core` | Filesystem, Search, Git, File, Execution, Environment, Results | 21 | 8,800 | 4,914 |
| `development` | core + Node.js, .NET, Python, Shell, Data, Liquibase, GitHub, GitLab | 41 | 17,360 | 9,502 |
| `infrastructure` | core + Kubernetes, Terraform, ArgoCD, Helm, Data, Liquibase, GitHub, GitLab | 54 | 19,733 | 10,221 |
| `all` (default) | everything | 65 | 24,513 | 12,806 |

o200k_base tokens, from `node scripts/schema-footprint.mjs` with the profile set.
**Wire** is the whole `tools/list` entry, `outputSchema` included. **Model** is name,
description and input schema — what a client typically puts in the prompt. v4.0.0's
`all` was 23,722 wire / 12,973 model (`fixtures/benchmarks/baselines/v4.0.0.json`).

The default stays `all` so an upgrade drops no tools. A profile only hides tools from
`tools/list`; it grants nothing, and `BASH_MCP_MODE` still gates `run`/`batch`.

## Client-side tool search

| Client | On-demand loading | What to do |
|---|---|---|
| Claude Code | Tool search is on by default for current Claude models: it lists names, loads a definition when a tool is about to be used | Nothing. `ENABLE_TOOL_SEARCH=false` turns it off; then pick a profile |
| Claude Code on Amazon Bedrock | Not documented as an exception, but Bedrock models reach Claude Code through a different API, so verify | Check `/context` after startup: deferred tools show as names only. If every bash-mcp schema is loaded, pick a profile |
| Claude Desktop, Cursor, Codex | Not documented | Pick a profile |
| VS Code (Copilot) | Caps a request at 128 tools across all servers; has its own tool-set picker | Pick a profile, or deselect groups in the tools picker |

The Bedrock row is an inference from the Claude Code docs, not a measured result.

## Choosing

- One client with tool search: leave `all`.
- Code work, no cluster: `development`. Cluster and IaC work: `infrastructure`.
- Many servers in one client, or no tool search: `core`, plus `run` for the occasional
  command a dropped group covered.
