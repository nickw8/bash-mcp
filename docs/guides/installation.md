# Installing bash-mcp in an MCP client

bash-mcp is a stdio server. Every client below starts it the same way, with
`npx -y @nickw8/bash-mcp`, and differs only in where the config lives.

| | |
|---|---|
| npm package | [`@nickw8/bash-mcp`](https://www.npmjs.com/package/@nickw8/bash-mcp) (the unscoped `bash-mcp` is someone else's) |
| MCP Registry name | `io.github.nickw8/bash-mcp` |
| Runtime | Node.js ≥ 20 |
| Transport | stdio. stdout carries only JSON-RPC; logs go to stderr |

**Latest or pinned.** `@nickw8/bash-mcp` follows the newest release each time
`npx` resolves it. Pin a version for a team or CI setup, so an upgrade happens
when you choose it: `@nickw8/bash-mcp@5.0.0`.

**Read-only by default.** `run` and `batch` refuse commands that write
(`BASH_MCP_MODE=readOnly`). Leave that in place unless you need otherwise; see
[configuration.md](../architecture/configuration.md).

## Environment variables

Set these in the client's `env` block. All are optional.

| Variable | Default | Values |
|---|---|---|
| `BASH_MCP_MODE` | `readOnly` | `readOnly`, `confirmWrites`, `off` — the `run`/`batch` write gate |
| `BASH_MCP_PROFILE` | `all` | `core`, `development`, `infrastructure`, `all` — which tools are listed |
| `BASH_MCP_RESPONSE_MODE` | `auto` | `auto`, `summary`, `compact`, `full` — the response budget |
| `BASH_MCP_RESULT_TTL` | `900` | seconds a trimmed result stays fetchable with `result_get`; `0` disables |
| `BASH_MCP_LOG` | `error` | `error`, `info`, `off` — stderr logging |

An unknown value for `BASH_MCP_PROFILE` or `BASH_MCP_RESPONSE_MODE` stops the
server at startup with the reason on stderr, rather than running with a guess.

## Claude Code

```bash
claude mcp add --transport stdio bash-mcp -- npx -y @nickw8/bash-mcp
# project-scoped (writes .mcp.json, shared with the repo):
claude mcp add --scope project --transport stdio bash-mcp -- npx -y @nickw8/bash-mcp
```

Or by hand, in `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "bash-mcp": {
      "command": "npx",
      "args": ["-y", "@nickw8/bash-mcp"],
      "env": { "BASH_MCP_MODE": "readOnly" }
    }
  }
}
```

Check it with `claude mcp list` or `/mcp` in a session.

Claude Code loads MCP tool schemas on demand (tool search) for current models,
so the size of the tool list matters less there than in other clients. See
[tool-discovery.md](tool-discovery.md). For the optional plugin with the
redirect hook, see [Claude Code plugin](#claude-code-plugin-optional).

## Claude Desktop

Edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "bash-mcp": {
      "command": "npx",
      "args": ["-y", "@nickw8/bash-mcp"]
    }
  }
}
```

Restart Claude Desktop. Desktop has no working directory of its own; pass a
`path`/`cwd` argument to the tools, or set `"cwd"` in the server entry if your
version supports it.

## Cursor

`.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "bash-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@nickw8/bash-mcp"]
    }
  }
}
```

## VS Code (GitHub Copilot agent mode)

`.vscode/mcp.json` in the workspace. VS Code uses `servers`, not `mcpServers`:

```json
{
  "servers": {
    "bash-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@nickw8/bash-mcp"]
    }
  }
}
```

Or from a terminal:

```bash
code --add-mcp '{"name":"bash-mcp","command":"npx","args":["-y","@nickw8/bash-mcp"]}'
```

VS Code sends at most 128 tools per request across all servers. With other
servers installed, set `BASH_MCP_PROFILE` to `development` or `infrastructure`
to list fewer.

## OpenAI Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.bash-mcp]
command = "npx"
args = ["-y", "@nickw8/bash-mcp"]
startup_timeout_sec = 30

[mcp_servers.bash-mcp.env]
BASH_MCP_MODE = "readOnly"
```

Or `codex mcp add bash-mcp -- npx -y @nickw8/bash-mcp`. The first `npx` run
downloads the package, so allow a longer `startup_timeout_sec` than the default.

## Any other stdio client

Point it at the command `npx` with arguments `-y @nickw8/bash-mcp`, or install
globally (`npm i -g @nickw8/bash-mcp`) and use the command `bash-mcp`. Clients
that read the MCP Registry can install it as `io.github.nickw8/bash-mcp`.

## Claude Code plugin (optional)

The plugin bundles the server entry and the redirect hook that points raw
`grep`/`cat`/`kubectl` calls at the structured tools:

```text
/plugin install bash-mcp --marketplace nickw8/bash-mcp
```

On a Claude Code version older than 2.1.275, add the marketplace first:
`/plugin marketplace add nickw8/bash-mcp`, then `/plugin install bash-mcp@bash-mcp`.
Remove it with `/plugin uninstall bash-mcp`.

The hook warns by default. `BASH_MCP_HOOK=block` makes it refuse the raw
command, `BASH_MCP_HOOK=off` silences it. Without the plugin,
`npx -y @nickw8/bash-mcp --install-claude` copies the same hook and rules into
`~/.claude`; `--uninstall-claude` removes them. See
[hooks-setup.md](../runbooks/hooks-setup.md).

## Troubleshooting

| Symptom | Check |
|---|---|
| Server does not start | `npx -y @nickw8/bash-mcp --doctor` lists missing CLIs and the Node version |
| Startup error naming an env var | The value is not one listed above |
| Client times out on first start | `npx` is downloading; raise the client's startup timeout, or install globally |
| A tool reports `cli_missing` | Install that CLI; `check_environment` shows what is on `PATH` |
| `run` refuses a command | Read-only mode; see [configuration.md](../architecture/configuration.md) |
| A response ends `[truncated to auto budget …]` | Page the rest with `result_get`, or set `BASH_MCP_RESPONSE_MODE=full` |
| Garbled frames or parse errors | Something wrote to stdout. bash-mcp does not; check wrapper scripts in the `command` |
