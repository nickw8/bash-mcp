# Recommended Claude Code hooks

Opt-in hooks that make agents use bash-mcp's structured tools instead of raw shell.

- **`bash-mcp-redirect.sh`** — `PreToolUse(Bash)` hook. Blocks shell commands that
  have a bash-mcp equivalent (e.g. `git status`, `kubectl get`, `cat`), warns for
  roadmap tools and pipelines, and lets write commands (`git commit`, `kubectl apply`)
  through. The command→tool mapping is the `RULES` array at the top of the script.
- **`settings.example.json`** — copy its `hooks` block into your Claude Code settings.

Full setup, behavior tiers, customizing, and the roadmap mappings:
**[../docs/recommended-hooks-setup.md](../docs/recommended-hooks-setup.md)**.
