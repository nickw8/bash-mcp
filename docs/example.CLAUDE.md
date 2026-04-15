# Example CLAUDE.md

This is an example of a **Tools** section you can add to your CLAUDE.md to have Claude prefer to use these tools instead of the raw bash commands.

```markdown
## Tools
**bash-mcp tools** return compact structured JSON. Prefer them over built-in equivalents:
- **Read files**: `cat` over `Read` for files >50 lines (200-line default cap, includes size/totalLines/truncated metadata). Still use `Read` for small files or before `Edit`.
- **Search content**: `rg` over `Grep`. Use `filesOnly: true` when you only need paths.
- **List/find files**: `ls` (with `all: true`), `glob`, `tree`, `find_files` over `Bash("ls")`, `Glob`, `Bash("find")`.
- **Git**: `git_status`, `git_log`, `git_branches`, `git_diff`, `git_diff_content` over `Bash("git ...")`.
- **Build/test/lint**: `run` over `Bash("npm ...")` — keeps last N lines where errors appear, discards verbose progress output.
- **Parallel lookups**: `batch` — combine independent commands into one tool call instead of multiple sequential calls.
- **JSON/YAML**: `jq`, `yq` over `Read` + parse. Returns structured output using less context than reading full files.
- **Infrastructure**: `kube_*`, `tf_*`, `helm_*`, `argo_*` over raw CLI calls — returns summarized structured output instead of verbose tables.
- **Deferred tools**: `ToolSearch` with `select:a,b,c` before first use — never guess params.
- **Still built-in**: `Edit`, `Write` — already minimal output.
```
