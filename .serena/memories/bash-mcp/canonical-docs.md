# Canonical docs — do not duplicate them here

As of 2026-08-03 the durable knowledge that used to live in this memory directory was
migrated into the repo, where it is version-controlled, reviewable, and linked from the
entry file. Six memories (`architecture`, `conventions`, `gotchas`, `next-steps-plans`,
`reduce-raw-bash-fallbacks-plan`, root `suggested_commands`) were deleted after migration
— they had begun to drift (both `architecture` and `conventions` claimed the build used
`tsgo`, which appears nowhere in the repo).

| Looking for | Read |
|---|---|
| Commands, every-task invariants, routing | `AGENTS.md` (canonical; `CLAUDE.md` is a one-line import) |
| Domain vocabulary | `CONTEXT.md` |
| Settled decisions + rationale | `docs/adr/0001`–`0008` |
| Module map, data flow, subsystem notes | `docs/architecture.md` |
| Adding/editing a tool, wiring allowlists | `docs/adding-tools.md` |
| Response helpers, formats, budgets, rg, benchmarks | `docs/output-conventions.md` |
| Env vars, timeouts, prerequisites | `docs/configuration.md` |
| Branching, tests, commit style | `CONTRIBUTING.md` |
| Issue tracker, triage labels, domain-doc rules | `docs/agents/` |

**Write new findings to those files, not to a memory.** A memory that restates a doc will
drift from it; that is exactly what happened here. Where a given instruction belongs is
set out in `.claude/rules/instructions.md`. A memory is still the right home for something
genuinely session-spanning and repo-external — a decision still being argued, or context
about the maintainer's workflow.

Open backlog is not here either: unbuilt work (e.g. `kube_service_endpoints_check`,
`argo_app_triage` from the infra-diagnostics-expansion theme) is specced under
`.claude/tasks/`, which is gitignored and therefore local-only.
