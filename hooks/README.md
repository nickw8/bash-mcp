# Recommended Claude Code hooks

Opt-in hooks that make agents use bash-mcp's structured tools instead of raw shell.

- **`bash-mcp-redirect.sh`** — `PreToolUse(Bash)` hook. Blocks shell commands that
  have a bash-mcp equivalent (e.g. `git status`, `kubectl get`, `cat`), warns for
  roadmap tools and pipelines, and lets write commands (`git commit`, `kubectl apply`)
  through. The command→tool mapping is the `RULES` array at the top of the script.
- **`settings.example.json`** — copy its `hooks` block into your Claude Code settings.
- **`../claude/rules/bash-mcp-tools.md`** — generated rules file (auto-loaded by Claude Code
  into every session) that advertises the full tool inventory so agents reach for the
  structured tools before raw Bash. Regenerate with `npm run docs:tools`.

Install both into `~/.claude/` with **`npm run claude:install`** (copy mode; `npm run
claude:check` reports drift without writing). If you installed the package from npm
rather than cloning, run **`npx @nickw8/bash-mcp --install-claude`** (`--check` for
drift) — same copy, no clone needed. Either way it prints the global `settings.json`
hook snippet to paste in.

Full setup, behavior tiers, customizing, and the roadmap mappings:
**[../docs/runbooks/hooks-setup.md](../docs/runbooks/hooks-setup.md)**.
