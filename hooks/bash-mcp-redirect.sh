#!/usr/bin/env bash
#
# bash-mcp-redirect.sh — Claude Code PreToolUse(Bash) hook
#
# Steers agents away from raw shell commands that have a structured bash-mcp
# equivalent. Two tiers:
#   - BLOCK: the MCP tool exists today → hard-stop the Bash call (decision:block)
#   - WARN:  the MCP tool is on the roadmap / not yet implemented, OR the command
#            is part of a compound pipeline → emit a non-blocking systemMessage
#
# Design goals:
#   - Explicit targeting: match specific subcommands ("git status", "kubectl get")
#     on a word boundary, NOT bare binaries — so "git commit", "git push",
#     "kubectl apply", etc. pass through untouched.
#   - Pipeline-safe: a mapped command inside a compound command (pipe, &&, ;,
#     subshell, redirect) is demoted from BLOCK to WARN, since the structured
#     tool may not compose into the user's pipeline.
#   - Self-contained: no external lib; fails OPEN (allows the command) on any error.
#
# Install: see hooks/settings.example.json and hooks/README.md.
# Requires: jq (already a bash-mcp prerequisite).

set -uo pipefail
trap 'exit 0' ERR   # fail open: never turn a hook bug into a blocked agent

# ── Rules ─────────────────────────────────────────────────────────────────
# Format: "<command prefix>|<action>|<bash-mcp tool>"
# Order matters: list more-specific prefixes BEFORE their generic parents
# (e.g. "kubectl get events" before "kubectl get").
#   action = block  → MCP tool exists, hard-stop simple invocations
#   action = warn   → roadmap tool (not yet implemented) or advisory only
RULES=(
  # ── Filesystem / search / data ──
  "cat|block|mcp__bash-mcp__cat"
  "ls|block|mcp__bash-mcp__ls"
  "tree|block|mcp__bash-mcp__tree"
  "du|block|mcp__bash-mcp__du"
  "find|block|mcp__bash-mcp__find_files (or glob)"
  "grep|block|mcp__bash-mcp__rg"
  "rg|block|mcp__bash-mcp__rg"
  "jq|block|mcp__bash-mcp__jq"
  "yq|block|mcp__bash-mcp__yq"

  # ── Git (read-only subcommands only; commit/push/etc. pass through) ──
  "git status|block|mcp__bash-mcp__git_status"
  "git log|block|mcp__bash-mcp__git_log"
  "git diff|block|mcp__bash-mcp__git_diff (or git_diff_content)"
  "git show|block|mcp__bash-mcp__git_diff_content"
  "git branch|block|mcp__bash-mcp__git_branches"

  # ── Kubernetes (specific reads before generic get) ──
  "kubectl get events|block|mcp__bash-mcp__kube_events_summary"
  "kubectl describe|block|mcp__bash-mcp__kube_diagnose_pod"
  "kubectl rollout status|block|mcp__bash-mcp__kube_deployment_status"
  "kubectl config get-contexts|block|mcp__bash-mcp__kube_contexts"
  "kubectl get|block|mcp__bash-mcp__kube_get"
  "kubectl logs|block|mcp__bash-mcp__kube_logs"

  # ── Terraform / OpenTofu ──
  "terraform state list|block|mcp__bash-mcp__tf_state_list"
  "terraform show|block|mcp__bash-mcp__tf_show"
  "terraform plan|block|mcp__bash-mcp__tf_plan_summary"
  "terraform workspace list|block|mcp__bash-mcp__tf_workspaces"
  "terraform output|block|mcp__bash-mcp__tf_outputs"
  "terraform providers|block|mcp__bash-mcp__tf_providers"
  "terraform validate|block|mcp__bash-mcp__tf_validate_summary"
  "tofu state list|block|mcp__bash-mcp__tf_state_list"
  "tofu show|block|mcp__bash-mcp__tf_show"
  "tofu plan|block|mcp__bash-mcp__tf_plan_summary"
  "tofu workspace list|block|mcp__bash-mcp__tf_workspaces"
  "tofu output|block|mcp__bash-mcp__tf_outputs"
  "tofu providers|block|mcp__bash-mcp__tf_providers"
  "tofu validate|block|mcp__bash-mcp__tf_validate_summary"

  # ── Helm ──
  "helm get values|block|mcp__bash-mcp__helm_values"
  "helm list|block|mcp__bash-mcp__helm_list"
  "helm status|block|mcp__bash-mcp__helm_status"
  "helm history|block|mcp__bash-mcp__helm_release_triage"

  # ── ArgoCD ──
  "argocd app list|block|mcp__bash-mcp__argo_apps"
  "argocd app get|block|mcp__bash-mcp__argo_app_detail"
  "argocd app diff|block|mcp__bash-mcp__argo_app_diff"

  # ── Node / dotnet / python tooling ──
  "npm run lint|block|mcp__bash-mcp__npm_lint"
  "npm run typecheck|block|mcp__bash-mcp__npm_typecheck"
  "npm test|block|mcp__bash-mcp__npm_test"
  "npm run|warn|mcp__bash-mcp__run (or npm_* tools)"
  "dotnet build|block|mcp__bash-mcp__dotnet_build"
  "dotnet test|block|mcp__bash-mcp__dotnet_test"
  "liquibase validate|block|mcp__bash-mcp__liquibase_validate"
  "liquibase updateSQL|block|mcp__bash-mcp__liquibase_update_sql"
  "liquibase status|block|mcp__bash-mcp__liquibase_status"
  "uv run ruff|block|mcp__bash-mcp__python_lint"
  "uv run pytest|block|mcp__bash-mcp__python_test"
  "ruff|block|mcp__bash-mcp__python_lint"
  "pytest|block|mcp__bash-mcp__python_test"
  "mypy|block|mcp__bash-mcp__python_typecheck"

  # ── Capability discovery ──
  "which|block|mcp__bash-mcp__check_environment"
  "command -v|block|mcp__bash-mcp__check_environment"
)

# ── Input ─────────────────────────────────────────────────────────────────
input="$(cat)"
command -v jq >/dev/null 2>&1 || exit 0   # no jq → fail open

cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[[ -z "$cmd" ]] && exit 0

# Normalize: trim whitespace, then peel off leading `sudo`/`env` wrappers and
# `VAR=value` assignments so the real command is what we match against
# (e.g. "env FOO=bar kubectl get" → "kubectl get"). A bare `make TARGET=x`
# is left alone: only the FIRST token is considered, and only if it is an
# assignment or a known wrapper.
trim_leading() { cmd="${cmd#"${cmd%%[![:space:]]*}"}"; }
trim_leading
while true; do
  first="${cmd%%[[:space:]]*}"
  case "$first" in
    sudo | env) cmd="${cmd#"$first"}"; trim_leading ;;
    [A-Za-z_]*=*) cmd="${cmd#"$first"}"; trim_leading ;;
    *) break ;;
  esac
done

# Peel binary-level GLOBAL flags that sit between the binary and its subcommand,
# so the subcommand bubbles to the front for matching
# (e.g. "git -C /p status" → "git status",
#       "kubectl --context prod get pods" → "kubectl get pods").
# Only leading flags are stripped; any pipe/chain tail is preserved so compound
# detection below still fires. Unknown flags are treated as booleans (drop the
# flag only). Inline "--flag=value" / "-c k=v" tokens are dropped whole.
strip_global_flags() {
  local bin="$1"; shift
  local valflags=" $* "        # flags that consume a following separate-word value
  local head rest tok val
  head="${cmd%%[[:space:]]*}"
  [[ "$head" != "$bin" ]] && return
  rest="${cmd#"$head"}"; rest="${rest#"${rest%%[![:space:]]*}"}"
  while [[ -n "$rest" ]]; do
    tok="${rest%%[[:space:]]*}"
    case "$tok" in
      -*=*)                    # --flag=value / -c=... : single token
        rest="${rest#"$tok"}"; rest="${rest#"${rest%%[![:space:]]*}"}" ;;
      -*)
        rest="${rest#"$tok"}"; rest="${rest#"${rest%%[![:space:]]*}"}"
        if [[ "$valflags" == *" $tok "* ]]; then   # consumes the next token as its value
          val="${rest%%[[:space:]]*}"
          rest="${rest#"$val"}"; rest="${rest#"${rest%%[![:space:]]*}"}"
        fi ;;
      *) break ;;              # first non-flag token = the subcommand
    esac
  done
  cmd="$bin $rest"
}

case "${cmd%%[[:space:]]*}" in
  git)     strip_global_flags git -C -c --git-dir --work-tree --namespace ;;
  kubectl) strip_global_flags kubectl --context -n --namespace --kubeconfig --cluster --user --server -s --token --as ;;
  helm)    strip_global_flags helm -n --namespace --kube-context --kube-apiserver --kubeconfig ;;
  argocd)  strip_global_flags argocd --server --auth-token ;;
esac

# Detect compound commands (pipes, chaining, subshells, redirects).
compound=0
case "$cmd" in
  *'|'* | *'&&'* | *'||'* | *';'* | *'$('* | *'`'* | *'>'* | *'<'*) compound=1 ;;
esac

emit_block() {
  printf '{"decision":"block","reason":"%s"}\n' "$1"
  exit 0
}
emit_warn() {
  printf '{"systemMessage":"%s"}\n' "$1"
  exit 0
}

# ── Targeted overrides (more specific than the generic RULES below) ─────────
# A `kubectl get` filtered to failed pods is a triage intent better served by
# kube_pod_failure_summary than by generic kube_get. Demote to warn in a
# pipeline, like any block rule.
case "$cmd" in
  "kubectl get "*)
    case "$cmd" in
      *"status.phase=Failed"*)
        if [[ "$compound" -eq 0 ]]; then
          emit_block "Use mcp__bash-mcp__kube_pod_failure_summary instead of 'kubectl get … --field-selector=status.phase=Failed' — structured triage, fewer tokens. (bash-mcp-redirect hook)"
        else
          emit_warn "bash-mcp: prefer mcp__bash-mcp__kube_pod_failure_summary over 'kubectl get … status.phase=Failed'"
        fi
        ;;
    esac
    ;;
esac

# ── Match ─────────────────────────────────────────────────────────────────
for rule in "${RULES[@]}"; do
  pattern="${rule%%|*}"
  rest="${rule#*|}"
  action="${rest%%|*}"
  tool="${rest#*|}"

  # Word-boundary prefix match: "git log ..." matches "git log", not "git logx".
  if [[ "$cmd " == "$pattern "* ]]; then
    if [[ "$action" == "block" && "$compound" -eq 0 ]]; then
      emit_block "Use $tool instead of '$pattern' — structured JSON, fewer tokens. (bash-mcp-redirect hook)"
    else
      # roadmap tool, or a compound command we won't hard-block
      emit_warn "bash-mcp: prefer $tool over '$pattern'"
    fi
  fi
done

exit 0
