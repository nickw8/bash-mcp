# bash-mcp Tools

<!-- GENERATED FILE — do not edit by hand. Regenerate with `npm run docs:tools`. -->

Prefer these bash-mcp MCP tools over raw shell / built-ins: structured JSON, fewer tokens.

| Category | Use bash-mcp | Instead of |
|----------|--------------|------------|
| Environment | `check_environment`, `list_guidance` | guessing which CLIs exist |
| Filesystem | `ls`, `tree`, `du`, `find_files` | `Bash(ls/tree/du/find)`, `Glob` |
| Search | `rg`, `glob` | `Grep`, `Bash(grep)` |
| File | `cat`, `outline` | `Read` (Read only immediately before Edit) |
| Git | `git_status`, `git_log`, `git_diff`, `git_branches`, `repo_health_summary`, `git_pr_context`, `git_diff_content` | `Bash(git)` |
| Kubernetes | `kube_get`, `kube_logs`, `kube_contexts`, `kube_diagnose_pod`, `kube_pod_failure_summary`, `kube_deployment_status`, `kube_events_summary` | `Bash(kubectl)` |
| Terraform | `tf_state_list`, `tf_show`, `tf_plan_summary`, `tf_workspaces`, `tf_outputs`, `tf_providers`, `tf_validate_summary`, `tf_modules_summary`, `tf_backend_info` | `Bash(terraform/tofu)` |
| Helm | `helm_list`, `helm_status`, `helm_values`, `helm_release_triage` | `Bash(helm)` |
| ArgoCD | `argo_apps`, `argo_app_detail`, `argo_app_diff`, `argo_app_health_summary` | `Bash(argocd)` |
| Data Processing | `jq`, `yq` | `Read` + manual parsing |
| .NET | `dotnet_build`, `dotnet_test` | `Bash(dotnet)` |
| Liquibase | `liquibase_validate`, `liquibase_update_sql`, `liquibase_status` | `Bash(liquibase)` |
| Node.js | `npm_lint`, `npm_test`, `npm_typecheck` | `Bash(npm)` |
| Python | `python_lint`, `python_test`, `python_typecheck` | `Bash(ruff/pytest/mypy)` |
| Shell | `bash_syntax_check`, `bash_lint`, `bash_test` | `Bash(shellcheck/bats/bash -n)` |
| Execution | `run`, `run_seq`, `batch` | `Bash(cd && cmd)`, sequential one-off calls |

**Diagnostic tools** collapse multi-call triage into one answer (status + likely causes + suggested next commands + evidence): `kube_diagnose_pod`, `kube_pod_failure_summary`, `kube_deployment_status`, `kube_events_summary`, `argo_app_health_summary`, `helm_release_triage`.

`Edit` and `Write` stay built-in. `cat` does NOT satisfy the Edit/Write "read first" guard — run the built-in `Read` immediately before editing.
