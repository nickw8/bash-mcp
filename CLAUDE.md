# bash-mcp
MCP server wrapping CLI tools with structured JSON output instead of raw text.

## Stack
TypeScript-go, Node.js >= 20 (ESM), MCP SDK, Zod schemas, Vitest, Biome (lint/format)

## Key Paths
- src/index.ts — server entry, registers all tool groups via stdio transport
- src/exec.ts — command execution (exec, execJson), timeout/buffer defaults
- src/response.ts — MCP response helpers (ok, err)
- src/shell.ts — shell escaping (shellEscape)
- src/tools/&lt;category&gt;/&lt;category&gt;.ts — tool implementations, each exports registerXTools(server)

## Tool Inventory
**Filesystem**: ls, tree, du, find_files | **Search**: rg, glob | **Git**: git_status, git_log, git_diff, git_branches, git_diff_content | **Kubernetes**: kube_get, kube_logs, kube_contexts | **Terraform**: tf_state_list, tf_show, tf_plan_summary, tf_workspaces | **Helm**: helm_list, helm_status, helm_values | **ArgoCD**: argo_apps, argo_app_detail, argo_app_diff | **JSON/YAML**: jq, yq | **File**: read_file, write_file | **Run**: run_command | **Batch**: run_batch

## Adding a New Tool
See docs/adding-tools.md

## Conventions
- Subpath imports: #exec, #response, #shell (package.json "imports")
- All schemas: Zod (inputSchema, outputSchema)
- All tools return: { content: [{ type: "text", text }], structuredContent: {...}, isError?: true }
- Co-located tests: &lt;name&gt;.test.ts next to &lt;name&gt;.ts
- Build with tsgo (preserves shebang), dev with tsx (fast reload)

## Timeouts
Filesystem/search/git: 30s | Kubernetes/Helm/ArgoCD: 15s | Terraform state: 30s | Terraform plan: 120s | All: 10 MB maxBuffer

## Commands
Build: npm run build | Dev: npm run dev | Test: npm test | Lint: npm run lint | Typecheck: npm run typecheck

## Prerequisites
Node.js >= 20 always required. Per-category: rg (ripgrep), git, kubectl, terraform, helm, argocd, jq, yq (mikefarah). Tools error gracefully if CLI missing.
