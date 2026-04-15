# Example CLAUDE.md

This is an example of a **Tools** section you can add to your CLAUDE.md to have Claude prefer to use these tools instead of the raw bash commands.

```markdown
## Tools

### HARD RULES — no exceptions
- **NEVER `cd` in Bash commands.** Always use absolute paths or `cwd` params. Changing CWD breaks all hooks. If you catch yourself writing `cd`, stop and rewrite with absolute paths.
- **NEVER use `Bash` when a bash-mcp tool exists.** This includes `npm`, `node`, `find`, `grep`, `git`, `ls`, `cat`. Use `run`, `find_files`, `rg`, `git_*`, `ls`, `cat` respectively. `Bash` is a last resort for commands with no bash-mcp equivalent.

### bash-mcp tool mapping
bash-mcp tools return compact structured JSON. **Always** use them over built-in equivalents:
- **Read files**: `cat` (200-line cap, includes metadata). Only use `Read` when you intend to `Edit` the file afterward.
- **Search content**: `rg` over `Grep`. Use `filesOnly: true` when you only need paths.
- **List/find files**: `ls` (with `all: true`), `glob`, `tree`, `find_files` over `Bash("ls")`, `Glob`, `Bash("find")`.
- **Git**: `git_status`, `git_log`, `git_branches`, `git_diff`, `git_diff_content` over `Bash("git ...")`.
- **Build/run commands**: `run` over `Bash`. Covers `npm run build`, `node -e "..."`, `dotnet build`, any CLI command. Use `run(command, args, cwd)` — not `Bash("cd foo && npm run build")`.
- **Lint/test/typecheck**: `npm_lint`, `npm_test`, `npm_typecheck` — structured output with parsed diagnostics. Use these over `run` for these specific tasks.
- **Parallel lookups**: `batch` — combine independent commands into one tool call instead of multiple sequential calls.
- **JSON/YAML**: `jq`, `yq` over `Read` + parse. Returns structured output using less context than reading full files.
- **Infrastructure**: `kube_*`, `tf_*`, `helm_*`, `argo_*` over raw CLI calls — returns summarized structured output instead of verbose tables.
- **Deferred tools**: `ToolSearch` with `select:a,b,c` before first use — never guess params.
- **Still built-in**: `Edit`, `Write` — already minimal output.
```
