/**
 * Tests for the bash-mcp-redirect.sh PreToolUse(Bash) hook.
 *
 * Spawns the real script with `{ tool_input: { command } }` on stdin and
 * asserts the decision it prints on stdout:
 *   - block:       { decision: "block", reason: "...<tool>..." }
 *   - warn:        { systemMessage: "...<tool>..." }
 *   - pass-through: no stdout (the agent's command is allowed unchanged)
 *
 * Requires `jq` and `bash` on PATH (both are bash-mcp prerequisites). The
 * script fails OPEN, so a missing dependency would surface here as unexpected
 * pass-throughs rather than a crash.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRegistry } from "../src/registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "bash-mcp-redirect.sh");

type Decision = {
  decision?: string;
  reason?: string;
  systemMessage?: string;
} | null;

/** Run the hook with a command and return the parsed decision (null = pass-through). */
function runHook(command: string): Decision {
  const res = spawnSync("bash", [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
  });
  const out = res.stdout.trim();
  return out ? (JSON.parse(out) as Decision) : null;
}

/** Run the hook with raw stdin (for the no-command / malformed cases). */
function runHookRaw(stdin: string): Decision {
  const res = spawnSync("bash", [HOOK], { input: stdin, encoding: "utf8" });
  const out = res.stdout.trim();
  return out ? (JSON.parse(out) as Decision) : null;
}

function expectBlock(command: string, toolFragment: string) {
  const d = runHook(command);
  expect(d?.decision, `${command} should block`).toBe("block");
  expect(d?.reason).toContain(toolFragment);
}

function expectWarn(command: string, toolFragment: string) {
  const d = runHook(command);
  expect(d?.systemMessage, `${command} should warn`).toBeDefined();
  expect(d?.systemMessage).toContain(toolFragment);
}

function expectPassThrough(command: string) {
  expect(runHook(command), `${command} should pass through`).toBeNull();
}

// Each case is its own `it`: one hook invocation is a real bash + jq spawn
// (~0.2s from Node), so batching a category into a single test pushed nine
// spawns past the default 5s budget under a loaded parallel run.

/** Commands that must hard-stop, and the tool the reason has to name. */
const BLOCKED: [command: string, tool: string][] = [
  // filesystem / search / data
  ["cat foo.txt", "mcp__bash-mcp__cat"],
  ["ls -la", "mcp__bash-mcp__ls"],
  ["tree src", "mcp__bash-mcp__tree"],
  ["du -sh .", "mcp__bash-mcp__du"],
  ["find . -name '*.ts'", "mcp__bash-mcp__find_files"],
  ["grep -r foo .", "mcp__bash-mcp__rg"],
  ["rg foo", "mcp__bash-mcp__rg"],
  ["jq '.x' a.json", "mcp__bash-mcp__jq"],
  ["yq '.x' a.yaml", "mcp__bash-mcp__yq"],
  // git read-only subcommands
  ["git status", "mcp__bash-mcp__git_status"],
  ["git log --oneline", "mcp__bash-mcp__git_log"],
  ["git diff HEAD~1", "mcp__bash-mcp__git_diff"],
  ["git show HEAD", "mcp__bash-mcp__git_diff_content"],
  ["git branch -a", "mcp__bash-mcp__git_branches"],
  // kubernetes implemented reads
  ["kubectl get pods -A", "mcp__bash-mcp__kube_get"],
  ["kubectl logs pod-x", "mcp__bash-mcp__kube_logs"],
  ["kubectl config get-contexts", "mcp__bash-mcp__kube_contexts"],
  // terraform / tofu implemented reads
  ["terraform state list", "mcp__bash-mcp__tf_state_list"],
  ["terraform show", "mcp__bash-mcp__tf_show"],
  ["terraform plan", "mcp__bash-mcp__tf_plan_summary"],
  ["terraform workspace list", "mcp__bash-mcp__tf_workspaces"],
  ["tofu state list", "mcp__bash-mcp__tf_state_list"],
  ["tofu show", "mcp__bash-mcp__tf_show"],
  ["tofu plan", "mcp__bash-mcp__tf_plan_summary"],
  ["tofu workspace list", "mcp__bash-mcp__tf_workspaces"],
  // terraform / tofu read-only tools (graduated)
  ["terraform output", "mcp__bash-mcp__tf_outputs"],
  ["terraform providers", "mcp__bash-mcp__tf_providers"],
  ["terraform validate", "mcp__bash-mcp__tf_validate_summary"],
  ["tofu output", "mcp__bash-mcp__tf_outputs"],
  ["tofu providers", "mcp__bash-mcp__tf_providers"],
  ["tofu validate", "mcp__bash-mcp__tf_validate_summary"],
  // helm / argocd implemented reads
  ["helm get values rel", "mcp__bash-mcp__helm_values"],
  ["helm list -A", "mcp__bash-mcp__helm_list"],
  ["helm status rel", "mcp__bash-mcp__helm_status"],
  ["helm history rel", "mcp__bash-mcp__helm_release_triage"],
  ["argocd app list", "mcp__bash-mcp__argo_apps"],
  ["argocd app get app1", "mcp__bash-mcp__argo_app_detail"],
  ["argocd app diff app1", "mcp__bash-mcp__argo_app_diff"],
  // node / dotnet / python tooling
  ["npm run lint", "mcp__bash-mcp__npm_lint"],
  ["npm run typecheck", "mcp__bash-mcp__npm_typecheck"],
  ["npm test", "mcp__bash-mcp__npm_test"],
  ["dotnet build", "mcp__bash-mcp__dotnet_build"],
  ["dotnet test", "mcp__bash-mcp__dotnet_test"],
  ["uv run ruff check .", "mcp__bash-mcp__python_lint"],
  ["uv run pytest -q", "mcp__bash-mcp__python_test"],
  ["pytest -q", "mcp__bash-mcp__python_test"],
  ["ruff check .", "mcp__bash-mcp__python_lint"],
  ["mypy src", "mcp__bash-mcp__python_typecheck"],
  // shell tooling
  ["shellcheck script.sh", "mcp__bash-mcp__bash_lint"],
  ["bats test/demo.bats", "mcp__bash-mcp__bash_test"],
  ["bash -n script.sh", "mcp__bash-mcp__bash_syntax_check"],
  // liquibase tooling
  ["liquibase validate", "mcp__bash-mcp__liquibase_validate"],
  ["liquibase updateSQL", "mcp__bash-mcp__liquibase_update_sql"],
  ["liquibase status --verbose", "mcp__bash-mcp__liquibase_status"],
  // capability discovery (graduated: check_environment now exists)
  ["which kubectl", "check_environment"],
  ["command -v jq", "check_environment"],
  // kubernetes diagnostics (graduated)
  ["kubectl get events -A", "kube_events_summary"],
  ["kubectl describe pod x", "kube_diagnose_pod"],
  ["kubectl rollout status deploy/x", "kube_deployment_status"],
];

describe("bash-mcp-redirect: implemented tools BLOCK", () => {
  it.each(BLOCKED)("blocks `%s` in favour of %s", (command, tool) => {
    expectBlock(command, tool);
  });
});

describe("bash-mcp-redirect: roadmap tools WARN", () => {
  it("generic npm run is advisory", () => {
    expectWarn("npm run build", "mcp__bash-mcp__run");
  });
});

/** Commands the hook must leave completely alone. */
const PASSED_THROUGH = [
  // mutating git / kubectl / terraform / helm commands
  "git commit -m wip",
  "git push origin main",
  "kubectl apply -f x.yaml",
  "terraform apply",
  "helm upgrade rel chart",
  // unmapped commands
  "echo hello",
  "make build",
];

describe("bash-mcp-redirect: write commands PASS THROUGH", () => {
  it.each(PASSED_THROUGH)("leaves `%s` untouched", (command) => {
    expectPassThrough(command);
  });
});

describe("bash-mcp-redirect: invariants", () => {
  it("a mapped command inside a pipeline is demoted to warn (never blocked)", () => {
    const d = runHook("kubectl get pods | grep foo");
    expect(d?.decision).toBeUndefined();
    expect(d?.systemMessage).toBeDefined();
  });

  it("a mapped command in a compound chain is demoted to warn", () => {
    const d = runHook("cat foo.txt && rm bar");
    expect(d?.decision).toBeUndefined();
    expect(d?.systemMessage).toBeDefined();
  });

  it("strips a leading sudo before matching", () => {
    expectBlock("sudo ls -la", "mcp__bash-mcp__ls");
  });

  it("respects subcommand word boundaries (git show-ref is not git show)", () => {
    expectPassThrough("git show-ref");
  });

  it("empty / missing command passes through", () => {
    expect(runHook("")).toBeNull();
    expect(runHookRaw("{}")).toBeNull();
    expect(runHookRaw("not json")).toBeNull();
  });
});

// ── Targeting not yet implemented (TDD red → green in this phase) ──────────
describe("bash-mcp-redirect: finer targeting", () => {
  it("strips leading `env VAR=value` wrappers before matching", () => {
    expectBlock("env FOO=bar kubectl get pods", "mcp__bash-mcp__kube_get");
    expectBlock("FOO=bar ls -la", "mcp__bash-mcp__ls");
  });

  it("routes a failed-pods `kubectl get` to the pod-failure summary (graduated)", () => {
    expectBlock(
      "kubectl get pods --field-selector=status.phase=Failed",
      "kube_pod_failure_summary",
    );
  });
});

// ── Registry ↔ hook parity ──────────────────────────────────────────────────
//
// A tool's `equivalentCommands` declares the raw CLI it replaces, so any such
// tool SHOULD also be redirected by this hook. This guard fails when a new
// wrapper ships with equivalentCommands but no corresponding hook rule — the
// exact drift that once left the liquibase tools un-advertised. Tools whose
// equivalents don't map to a single redirectable subcommand are exempted with a
// documented reason.
describe("bash-mcp-redirect: registry parity", () => {
  /**
   * Tools that carry equivalentCommands but intentionally have no hook rule.
   * Each maps to *why* a PreToolUse(Bash) redirect doesn't apply.
   */
  const EXEMPT: Record<string, string> = {
    run_seq:
      "escape hatch — equivalent is an arbitrary `cmd1 && cmd2` chain, not a redirectable subcommand",
    glob: "shell-builtin globbing, not a command an agent invokes; `find` already redirects to find_files",
    git_pr_context:
      "composite summary; its underlying git reads already redirect to git_log/git_diff",
    repo_health_summary:
      "composite summary; its underlying git reads already redirect to git_status/git_log",
    argo_app_health_summary:
      "composite summary; `argocd app get` already redirects to argo_app_detail",
  };

  /** The hook references tools by full `mcp__bash-mcp__<name>` id; match on a boundary. */
  function referencedInHook(hook: string, name: string): boolean {
    return new RegExp(`mcp__bash-mcp__${name}(?![a-z0-9_])`).test(hook);
  }

  it("every tool with equivalentCommands is named in the hook (or explicitly exempt)", () => {
    const hook = readFileSync(HOOK, "utf8");
    const missing = buildRegistry()
      .filter((t) => t.equivalentCommands?.length)
      .filter((t) => !referencedInHook(hook, t.name))
      .map((t) => t.name)
      .filter((name) => !(name in EXEMPT));
    expect(
      missing,
      `These tools declare equivalentCommands but no hook rule references them. ` +
        `Add a RULES entry in bash-mcp-redirect.sh, or add an EXEMPT reason in this test.`,
    ).toEqual([]);
  });

  it("exemptions stay relevant: each exempt tool still exists and lacks a hook rule", () => {
    const hook = readFileSync(HOOK, "utf8");
    const byName = new Map(buildRegistry().map((t) => [t.name, t]));
    for (const name of Object.keys(EXEMPT)) {
      expect(byName.has(name), `exempt tool ${name} no longer exists`).toBe(
        true,
      );
      expect(
        referencedInHook(hook, name),
        `exempt tool ${name} now has a hook rule — remove it from EXEMPT`,
      ).toBe(false);
    }
  });
});
