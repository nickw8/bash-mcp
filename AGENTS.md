# bash-mcp

MCP server wrapping CLI tools with structured JSON output instead of raw text.

## Commands

```bash
npm run build        # tsup bundle
npm run dev          # tsx, fast reload
npm test             # vitest run
npm run lint         # biome check .   (lint:fix to auto-fix)
npm run typecheck    # tsc --noEmit
npm run docs:tools   # regenerate docs/tools.md + README regions + claude/rules/bash-mcp-tools.md
npm run claude:install   # copy rules + hook into ~/.claude  (claude:check for dry-run)
```

`npm run docs:tools -- --check` fails if the generated docs are stale. npm-installed
consumers use `npx @nickw8/bash-mcp --install-claude [--check]` instead of `claude:install`.

## Rules for every task

1. **Register tools with `defineTool(server, name, config, handler)` from `#tool`** — never `server.registerTool` directly. It adds wide-event logging, uniform error catching, and registry recording.
2. **Generated content is never hand-edited.** `docs/tools.md`, the README `<!-- BEGIN/END GENERATED: tools|which-tool -->` regions, and `claude/rules/bash-mcp-tools.md` come from `npm run docs:tools`. Edit the source, run the command; a guard test fails otherwise.
3. **New tool groups go in the `GROUPS` table in `src/registry.ts`**, not `src/index.ts`.
4. **Use subpath imports**: `#exec`, `#response`, `#shell`, `#format`, `#parsers`, `#tool`, `#error`, `#logger`, `#safety` (package.json `"imports"`).
5. **All schemas are Zod** (`inputSchema`, `outputSchema`); every tool returns `{ content: [...], structuredContent: {...}, isError?: true }` and never throws.

Diagnostic tools (kube_diagnose_pod, `*_summary`, helm_release_triage,
argo_app_health_summary, repo_health_summary) return
`{ status/healthy, likelyCauses[], suggestedNextCommands[], evidence[] }` — they collapse
multi-call triage into one answer. New diagnostics follow that shape.

## Guides

| Read when | Guide |
|---|---|
| Adding or editing a tool, or adding a group | [docs/adding-tools.md](docs/adding-tools.md) |
| Deciding what a tool returns, or shaping its text block | [docs/output-conventions.md](docs/output-conventions.md) |
| Tracing how the server, registry, or exec layer fits together | [docs/architecture.md](docs/architecture.md) |
| A tool times out, a CLI is missing, or `run`/`batch` is blocked | [docs/configuration.md](docs/configuration.md) |
| Looking up a tool's name, args, or output shape | [docs/tools.md](docs/tools.md) (generated) |
| Wiring the redirect hook into a Claude install | [docs/recommended-hooks-setup.md](docs/recommended-hooks-setup.md) |
| Justifying a tool's token savings | [docs/token-benchmarks.md](docs/token-benchmarks.md) |
| Branching, PRs, code style | [CONTRIBUTING.md](CONTRIBUTING.md) |

Domain vocabulary is in [CONTEXT.md](CONTEXT.md) — use its terms in issues, test names,
and proposals. Settled decisions are in [docs/adr/](docs/adr/); read the relevant one
before changing registration, logging, output shape, or safety defaults, and if your
change contradicts one, say so rather than quietly overriding it.

`AGENTS.md` is canonical; `CLAUDE.md` is a one-line import of it. Where a new instruction
belongs is in [.claude/rules/instructions.md](.claude/rules/instructions.md).

## Agent skills

### Issue tracker

GitHub Issues on `nickw8/bash-mcp`, via the `gh` CLI. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

The five canonical roles, label string = role name. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root (neither exists yet;
`/domain-modeling` creates them lazily). See [docs/agents/domain.md](docs/agents/domain.md).
