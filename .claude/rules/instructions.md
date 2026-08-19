---
paths: ["AGENTS.md", "CLAUDE.md", "docs/**"]
---

# Where an instruction goes

| Scope | Goes in |
|---|---|
| True for **every single task** | root `AGENTS.md` |
| One domain | its own file under `docs/` |
| Only while editing one part of the tree | a path-scoped rule here in `.claude/rules/` |
| Has internal structure worth navigating | a nested tree under that file's directory |

The root is a routing table, not a manual. It loads on every task, so it holds only the
project sentence, the commands, the handful of invariants that apply everywhere, and one
link row per guide phrased as *read when*. Anything needing a paragraph of caveats is a
guide with a one-line pointer, not a root section.

`AGENTS.md` is canonical. `CLAUDE.md` is a one-line `@AGENTS.md` import — never a second
copy, never a symlink.

## Delete instead of relocating when the instruction is

- **Redundant** — a competent agent already does this unprompted.
- **Too vague to act on** — no verifiable change in behavior.
- **Overly obvious** — "write clean code", "use good names".
- **Stated elsewhere already** — one canonical home, pointers from the rest.

Generated content (`docs/tools.md`, the README `GENERATED` regions,
`claude/rules/bash-mcp-tools.md`) is never edited by hand and never restated in prose that
can drift from it — point at it instead.
