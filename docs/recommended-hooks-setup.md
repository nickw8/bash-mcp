# Recommended Hooks Setup

bash-mcp ships optional [Claude Code hooks](https://docs.claude.com/en/docs/claude-code/hooks)
that steer agents toward the structured tools instead of raw shell. They live in
the [`hooks/`](../hooks) directory and are **opt-in** — you wire them into your own
Claude Code settings.

## How hooks work (two pieces)

A hook is **registration + script**, kept separate:

| Piece | What it is | Where |
|-------|-----------|-------|
| **Registration** | A `command` entry under the `hooks` key that tells Claude Code *when* to run *what* | your `settings.json` |
| **Script** | The actual program that inspects the tool call and responds | a file on disk (here: `hooks/bash-mcp-redirect.sh`) |

Claude Code only runs what's registered in `settings.json`. A script sitting in a
`hooks/` folder does nothing on its own — there is no auto-discovery. The
registration's `command` points at the script.

## What `bash-mcp-redirect.sh` does

A `PreToolUse` hook on the `Bash` tool. When a Bash command has a structured
bash-mcp equivalent it either:

- **blocks** the call (when the matching tool exists today), or
- **warns** (non-blocking) when the tool is on the roadmap, or when the command
  is part of a pipeline (`|`, `&&`, `;`, subshell, redirect) where the structured
  tool may not compose.

Matching is on a **word-boundary subcommand prefix**, so only read-style
subcommands are caught:

- `git status` / `git log` / `git diff` → blocked; `git commit` / `git push` → allowed
- `kubectl get` / `kubectl logs` → blocked; `kubectl apply` / `kubectl delete` → allowed
- `terraform plan` / `terraform show` (and `tofu …`) → blocked; `terraform apply` → allowed

The full mapping is the `RULES` array at the top of the script.

## Install — per project (recommended)

Add the hook to the **target project's** `.claude/settings.json` (the project
you're working in, not bash-mcp itself), pointing at wherever you keep the
script. The easiest path is to copy [`hooks/bash-mcp-redirect.sh`](../hooks/bash-mcp-redirect.sh)
into that project, then register it:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/hooks/bash-mcp-redirect.sh\"",
            "timeout": 5,
            "statusMessage": "Checking for bash-mcp alternatives..."
          }
        ]
      }
    ]
  }
}
```

`$CLAUDE_PROJECT_DIR` resolves to the project root, so the path works for anyone
who clones the project. This snippet is also provided as
[`hooks/settings.example.json`](../hooks/settings.example.json) — copy its `hooks`
block into your settings.

## Install — global (all projects)

1. Copy the script somewhere stable, e.g. `~/.claude/hooks/bash-mcp-redirect.sh`.
2. Add the same `PreToolUse` entry to `~/.claude/settings.json`, using an
   **absolute** path in `command` (e.g. `bash ~/.claude/hooks/bash-mcp-redirect.sh`).

After editing settings, restart Claude Code or run `/hooks` so the change is
picked up.

## Customizing

- **Add a mapping:** append a `"<command prefix>|<action>|<tool>"` line to `RULES`.
  Put more-specific prefixes *before* their generic parent (e.g.
  `kubectl get events` before `kubectl get`).
- **Graduate a roadmap tool:** once a tool is implemented, change its rule's
  action from `warn` to `block`.
- **Loosen/tighten:** flip any `block` to `warn` to make it advisory only.

## Requirements & safety

- Requires `jq` (already a bash-mcp prerequisite).
- The hook **fails open**: if `jq` is missing or the script errors, the command is
  allowed rather than blocked — a hook bug never wedges your agent.

See [`hooks/README.md`](../hooks/README.md) for the per-tier behavior table and the
current list of roadmap mappings.
