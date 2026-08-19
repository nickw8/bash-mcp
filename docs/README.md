# Docs Index

Every guide in this tree, and when to read it. `AGENTS.md` at the repo root routes here.
Each folder has its own `README.md` listing what is inside it.

| Folder | What lives there |
|---|---|
| [`architecture/`](architecture/README.md) | How the server is put together — module map, request flow, the exec/registry/response layers, and [`configuration.md`](architecture/configuration.md) for env vars, timeouts, and prerequisites |
| [`guides/`](guides/README.md) | How to add a tool, shape its output, and justify its token savings |
| [`runbooks/`](runbooks/README.md) | Setup procedures you run once per machine — wiring the redirect hook into a Claude install |
| [`adr/`](adr/) | Architecture decision records — the decisions with a rejected alternative |
| `agents/` | Agent-facing process docs — [`issue-tracker.md`](agents/issue-tracker.md), [`triage-labels.md`](agents/triage-labels.md), [`domain.md`](agents/domain.md) |

## Flat files

Two files stay at `docs/` root:

- [`tools.md`](tools.md): the full tool reference — name, args, output shape for every tool.
  **Generated** by `npm run docs:tools` from the registry ([ADR-0002](adr/0002-registry-generates-all-docs.md));
  never hand-edited, and pinned at this path because `scripts/gen-tool-docs.mjs` writes it there.
- [`example.CLAUDE.md`](example.CLAUDE.md): a Tools section a consumer can paste into their own
  `CLAUDE.md`. Shipped for users of the package, not a rule for this repo.

## `adr/`

Why the codebase is shaped this way: `defineTool` wrapping every registration, the registry
generating all docs, `readOnly` as the default mode, wide events to stderr, a wrapped failure
being a result, the compact text block, regex outline extractors, `cat` not satisfying the
Edit read-guard, `structuredContent` as what the agent reads, the benchmark corpus as a
contract, and the `outputSchema` defining the error payload.

Read before re-litigating any of those.
