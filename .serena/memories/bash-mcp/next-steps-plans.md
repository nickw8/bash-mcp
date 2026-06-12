# next-steps.md → planned task folders (2026-05-31)

scratch/next-steps.md (10 ideas) was grouped by theme into 5 task folders under
`.claude/tasks/`, each with spec.md/plan.md/review.md. Patterns checked against
/arch:node + /arch:guide (const dispatch tables, as const/satisfies, Decorator
for defineTool, diagnostic shape reuse — no overengineering).

| Folder | Ideas | Core change |
|--------|-------|-------------|
| safe-defaults-and-packaging | #1, #5 | flip `resolveMode` default off→readOnly (src/safety.ts:27); add docs/hooks to package.json files |
| tool-selection-guidance | #2, #3 | new `list_guidance` tool (clone env.ts PROBES pattern) + README "which tool" table |
| tool-reference-and-transparency | #6, #10 | `equivalentCommands` via defineTool `_meta` + tool registry + `docs:tools` generator (token-benchmark.mjs precedent) |
| doctor-cli | #4 | `bash-mcp --doctor` branch in index.ts main(); reuse env PROBES/runProbe |
| infra-diagnostics-expansion | #7, #8, #9 | kube_service_endpoints_check, argo_app_triage (argo→kube correlation), tf_plan_summary byModule/byProvider/byType + riskyChanges |

Recommended first task: `safe-defaults-and-packaging` (smallest, highest user
impact, unblocks correct README defaults). Key cross-link: #6 registry could later
generate the #2/#3 tables and README "## Tools" section (kills hand-maintained lists).

Behavior-change note: flipping BASH_MCP_MODE default is `Changelog: breaking`
(unset env now blocks writes). Maintainer keeps `BASH_MCP_MODE=off` in their own
client config; the block message in safety.ts:104 must change "Unset" → "set ...=off".
Commit style: conventional commits, NO Changelog/Co-Authored-By trailers (user
chose to follow repo convention over the /project:plan template). See
`mem:bash-mcp/conventions`.
