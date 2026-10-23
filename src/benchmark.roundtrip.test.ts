import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getEncoding } from "js-tiktoken";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
const { registerNpmTools } = await import("./tools/npm/npm.js");
const { registerPythonTools } = await import("./tools/python/python.js");
const { registerShellTools } = await import("./tools/shell/shell.js");

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
 *     variants, outline, the test runners, dotnet, kube/helm/argo)
 *
 * The diagnostic runners (lint, typecheck, syntax check) are in the table: the
 * CLI exits non-zero WITH findings, so those cases set `exitCode`, and
 * bash_syntax_check reads stderr, so its case sets `stream`.
 * Those keep their per-group tests; the corpus only claims the single-call ones.
 */
const CASES: Array<{
  id: string;
  register: (server: McpServer) => void;
  tool: string;
  args: Record<string, unknown>;
  /** The CLI's exit code (default 0). Linters exit non-zero with findings. */
  exitCode?: number;
  /** Where the fixture is fed: stdout (default) or stderr (`bash -n`). */
  stream?: "stderr";
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
  {
    id: "npm_lint",
    register: registerNpmTools,
    tool: "npm_lint",
    args: { cwd: "." },
    exitCode: 1,
  },
  {
    id: "python_lint",
    register: registerPythonTools,
    tool: "python_lint",
    args: { cwd: "." },
    exitCode: 1,
  },
  {
    id: "bash_lint",
    register: registerShellTools,
    tool: "bash_lint",
    args: { files: "sample.sh" },
    exitCode: 1,
  },
  {
    id: "npm_typecheck",
    register: registerNpmTools,
    tool: "npm_typecheck",
    args: { cwd: "." },
    exitCode: 2,
  },
  {
    id: "python_typecheck",
    register: registerPythonTools,
    tool: "python_typecheck",
    args: { cwd: "." },
    exitCode: 1,
  },
  {
    id: "bash_syntax_check",
    register: registerShellTools,
    tool: "bash_syntax_check",
    args: { files: "e1.sh" },
    exitCode: 2,
    stream: "stderr",
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
    const text = handlerStdout(c.id);
    execMock.mockResolvedValue({
      ...execOk(c.stream === "stderr" ? "" : text, c.stream ? text : ""),
      exitCode: c.exitCode ?? 0,
    });

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

/**
 * Wire-level pricing: the whole serialized CallToolResult (text block plus
 * structuredContent), from the real handler, not the expected.txt payload.
 * The fixture benchmark prices only what the agent reads (ADR-0009); this is
 * what crosses the pipe, which a client that forwards the text block as well
 * pays for. `BENCH_REPORT=1` prints the table.
 */
describe("benchmark corpus wire size", () => {
  const enc = getEncoding("o200k_base");
  const tok = (s: string) => enc.encode(s).length;
  const rows: string[] = [];

  afterAll(() => {
    if (process.env.BENCH_REPORT) {
      console.log(["id\traw\tstruct\ttext\twire", ...rows].join("\n"));
    }
  });

  it.each(
    CASES,
  )("$id text block is no larger than the raw output", async (c) => {
    const text = handlerStdout(c.id);
    execMock.mockResolvedValue({
      ...execOk(c.stream === "stderr" ? "" : text, c.stream ? text : ""),
      exitCode: c.exitCode ?? 0,
    });
    const result = await captureHandler(c.register, c.tool)(c.args);
    const rawT = tok(readFileSync(join(fixturesRoot, c.id, "raw.txt"), "utf8"));
    const structT = tok(JSON.stringify(result.structuredContent));
    const textT = tok((result.content ?? []).map((b) => b.text).join("\n"));
    const wireT = tok(JSON.stringify(result));
    rows.push([c.id, rawT, structT, textT, wireT].join("\t"));
    // The text block restates rows in the tool's list format plus a metadata
    // line (counts, tf_state_list's byType rollup). Allow that line; a text
    // block well past the raw output means it is echoing the payload as JSON.
    expect(textT).toBeLessThanOrEqual(rawT * 1.25 + 40);
  });

  it("auto budget caps a 2,000-resource state list and keeps the rest", async () => {
    const addresses = Array.from(
      { length: 2000 },
      (_, i) => `module.app.aws_iam_role_policy_attachment.attach[${i}]`,
    );
    execMock.mockResolvedValue(execOk(`${addresses.join("\n")}\n`));
    const result = await captureHandler(
      registerTerraformTools,
      "tf_state_list",
    )({ cwd: "." });
    const sc = result.structuredContent;
    const rawT = tok(addresses.join("\n"));
    const wireT = tok(JSON.stringify(result));
    rows.push(
      [
        "tf_state_list x2000 (auto)",
        rawT,
        tok(JSON.stringify(sc)),
        "-",
        wireT,
      ].join("\t"),
    );
    expect(sc.count).toBe(2000);
    expect(sc.retained.omitted).toEqual([
      { path: "resources", total: 2000, shown: sc.resources.length },
    ]);
    expect(sc.retained.id).toMatch(/^r_/);
    expect(wireT).toBeLessThan(rawT / 3);

    // The same call in full mode is the v4 behaviour: the comparison row.
    process.env.BASH_MCP_RESPONSE_MODE = "full";
    try {
      const full = await captureHandler(
        registerTerraformTools,
        "tf_state_list",
      )({ cwd: "." });
      rows.push(
        [
          "tf_state_list x2000 (full, v4)",
          rawT,
          tok(JSON.stringify(full.structuredContent)),
          "-",
          tok(JSON.stringify(full)),
        ].join("\t"),
      );
      expect(full.structuredContent.retained).toBeUndefined();
    } finally {
      delete process.env.BASH_MCP_RESPONSE_MODE;
    }
  });
});
