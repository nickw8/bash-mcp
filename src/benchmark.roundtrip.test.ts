import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixturesRoot } from "../scripts/benchmark-core.mjs";
import { captureHandler, execOk } from "./test-support.js";

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exec.js")>();
  return { ...actual, exec: vi.fn() };
});

const { exec } = await import("#exec");
const execMock = vi.mocked(exec);

const { registerFilesystemTools } = await import(
  "./tools/filesystem/filesystem.js"
);
const { registerGitTools } = await import("./tools/git/git.js");
const { registerTerraformTools } = await import(
  "./tools/terraform/terraform.js"
);

/**
 * The benchmark corpus doubles as a behavioral contract corpus (ADR-0010).
 *
 * `fixtures/benchmarks/<id>/expected.txt` was written by hand to price the
 * structured payload, and nothing ever checked that the tool actually emits it.
 * That let `ls` ship a fixture describing a payload it had never produced. Here
 * the fixture's raw CLI output is fed to the real handler through a mocked
 * `exec`, and the payload must equal `expected.txt` exactly. `expected.txt` is
 * the contract: a mismatch is a handler bug, not a stale fixture.
 *
 * `raw.txt` must stay in the human form the benchmark prices (`git log`'s
 * default paragraphs, `tree`'s ASCII art, `du -h`), but several tools invoke
 * the CLI in a machine form instead (`--format=%H‖…`, `-J`, `-k`). Those
 * fixtures carry an extra `handler-stdout.txt` holding the machine form; it is
 * the handler's input where present, `raw.txt` where not.
 *
 * Fixtures excluded from this table, and why:
 *   - the payload comes from several exec calls whose order this table can't
 *     express (check_environment, kube_diagnose_pod, git_status, repo health)
 *   - the tool parses a file it reads itself rather than stdout (tf_outputs,
 *     tf_plan_summary via `-json` streaming, liquibase_*)
 *   - the raw fixture is a transcript of a tool that isn't wrapped 1:1 (rg
 *     variants, outline, the npm/python/dotnet/bash runners, kube/helm/argo)
 * Those keep their per-group tests; the corpus only claims the single-call ones.
 */
const CASES: Array<{
  id: string;
  register: (server: McpServer) => void;
  tool: string;
  args: Record<string, unknown>;
}> = [
  {
    id: "ls",
    register: registerFilesystemTools,
    tool: "ls",
    args: { path: "." },
  },
  {
    id: "du",
    register: registerFilesystemTools,
    tool: "du",
    args: { path: "." },
  },
  {
    id: "tree",
    register: registerFilesystemTools,
    tool: "tree",
    args: { path: "src" },
  },
  {
    id: "git_branches",
    register: registerGitTools,
    tool: "git_branches",
    args: {},
  },
  { id: "git_log", register: registerGitTools, tool: "git_log", args: {} },
  {
    id: "tf_state_list",
    register: registerTerraformTools,
    tool: "tf_state_list",
    args: { cwd: "." },
  },
];

/** The machine form when the tool asks for one, the human form otherwise. */
function handlerStdout(id: string): string {
  const machine = join(fixturesRoot, id, "handler-stdout.txt");
  const path = existsSync(machine)
    ? machine
    : join(fixturesRoot, id, "raw.txt");
  return readFileSync(path, "utf8");
}

describe("benchmark corpus round-trip", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it.each(CASES)("$id emits its expected.txt payload", async (c) => {
    execMock.mockResolvedValue(execOk(handlerStdout(c.id)));

    const handler = captureHandler(c.register, c.tool);
    const result = await handler(c.args);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(
      JSON.parse(
        readFileSync(join(fixturesRoot, c.id, "expected.txt"), "utf8"),
      ),
    );
  });
});
