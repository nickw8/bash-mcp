# bash-mcp
MCP server wrapping CLI tools with structured JSON output instead of raw text.

## Stack
TypeScript, Node.js >= 20 (ESM), MCP SDK, Zod schemas, Vitest, Biome (lint/format), tsup (bundler)

## Key Paths
- src/index.ts — server entry, registers all tool groups via stdio transport
- src/exec.ts — command execution (exec, execJson), timeout/buffer defaults
- src/response.ts — MCP response helpers (ok, okList, err)
- src/format.ts — multi-format list output (TSV, columnar, JSON)
- src/shell.ts — shell escaping (shellEscape)
- src/parsers/types.ts — shared interfaces (Diagnostic, TestResult, TestSuite)
- src/tools/&lt;category&gt;/&lt;category&gt;.ts — tool implementations, each exports registerXTools(server)

## Tool Inventory
**Filesystem**: ls, tree, du, find_files | **Search**: rg, glob | **Git**: git_status, git_log, git_diff, git_branches, git_diff_content | **Kubernetes**: kube_get, kube_logs, kube_contexts | **Terraform**: tf_state_list, tf_show, tf_plan_summary, tf_workspaces | **Helm**: helm_list, helm_status, helm_values | **ArgoCD**: argo_apps, argo_app_detail, argo_app_diff | **JSON/YAML**: jq, yq | **File**: cat, outline | **Run**: run | **Batch**: batch | **npm**: npm_lint, npm_test, npm_typecheck | **dotnet**: dotnet_build, dotnet_test

## Adding a New Tool
See docs/adding-tools.md

## Conventions
- Subpath imports: #exec, #response, #shell, #format, #parsers (package.json "imports")
- All schemas: Zod (inputSchema, outputSchema)
- All tools return: { content: [{ type: "text", text }], structuredContent: {...}, isError?: true }
- Co-located tests: &lt;name&gt;.test.ts next to &lt;name&gt;.ts
- Build with tsup (single-file bundle with shebang), dev with tsx (fast reload)
- Shared parser types in src/parsers/types.ts — reuse Diagnostic/TestResult/TestSuite across tool groups

## Timeouts
Filesystem/search/git: 30s | Kubernetes/Helm/ArgoCD: 15s | Terraform state: 30s | Terraform plan: 120s | dotnet build/test: 120s | All: 10 MB maxBuffer

## Commands
Build: npm run build | Dev: npm run dev | Test: npm test | Lint: npm run lint | Typecheck: npm run typecheck

## Prerequisites
Node.js >= 20 always required. Per-category: rg (ripgrep), git, kubectl, terraform, helm, argocd, jq, yq (mikefarah), dotnet. Tools error gracefully if CLI missing.
