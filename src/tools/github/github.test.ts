/**
 * Tests for the GitHub tools: the pure parsers against a real failed run's
 * `gh run view --json` and `--log-failed` output, and both handlers with
 * `exec`/`execJson` mocked.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureHandlers, execOk } from "../../test-support.js";
import {
  errorLines,
  type GhRun,
  summarizeChecks,
  triageWorkflowRun,
} from "./parse.js";

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../exec.js")>();
  return { ...actual, exec: vi.fn(), execJson: vi.fn() };
});

const { exec, execJson } = await import("#exec");
const execMock = vi.mocked(exec);
const execJsonMock = vi.mocked(execJson);
const { registerGithubTools } = await import("./github.js");
const handlers = captureHandlers(registerGithubTools);

const FIXTURES = join(__dirname, "../../../fixtures/github");
const RUN: GhRun = JSON.parse(
  readFileSync(join(FIXTURES, "run-view-failed.json"), "utf8"),
);
const LOG = readFileSync(join(FIXTURES, "log-failed.txt"), "utf8");

describe("errorLines", () => {
  it("keeps the ##[error] cause, not the cleanup tail or exit-code line", () => {
    expect(errorLines(LOG)).toEqual([
      "test (22): AssertionError: expected [ { result: { …(4) }, …(2) }, …(5) ] to have a length of 7 but got 6",
    ]);
  });

  it("falls back to the exit-code line when it is the only error", () => {
    const log =
      "build\tstep\t2026-01-01T00:00:00.0Z ##[error]Process completed with exit code 2.";
    expect(errorLines(log)).toEqual([
      "build: Process completed with exit code 2.",
    ]);
  });
});

describe("triageWorkflowRun", () => {
  it("names the failed job and step of a real failed run", () => {
    const t = triageWorkflowRun(RUN, LOG);
    expect(t.status).toBe("failure");
    expect(t.run).toBe(32299114656);
    expect(t.failedJobs).toEqual([
      expect.objectContaining({
        name: "test (22)",
        failedSteps: ["Run tests"],
      }),
    ]);
    expect(t.likelyCauses).toEqual([
      "Job 'test (22)' failed at step 'Run tests'.",
    ]);
  });

  // The benchmark prices this payload; it must be what the parser emits (ADR-0010).
  it("emits exactly the benchmark fixture's payload", () => {
    const expected = readFileSync(
      join(FIXTURES, "../benchmarks/gh_run_failure_summary/expected.txt"),
      "utf8",
    );
    expect(JSON.stringify(triageWorkflowRun(RUN, LOG))).toBe(expected);
  });

  it("reports a green run as Healthy and one in flight as InProgress", () => {
    expect(
      triageWorkflowRun({ status: "completed", conclusion: "success" }).status,
    ).toBe("Healthy");
    expect(triageWorkflowRun({ status: "in_progress" }).status).toBe(
      "InProgress (in_progress)",
    );
  });
});

describe("summarizeChecks", () => {
  const checks = [
    { name: "lint", workflow: "CI", bucket: "pass", link: "l1" },
    { name: "test", workflow: "CI", bucket: "fail", link: "l2" },
    { name: "e2e", workflow: "CI", bucket: "pending", link: "l3" },
  ];

  it("counts every check and lists only the ones not passed", () => {
    const s = summarizeChecks(checks);
    expect(s.counts).toEqual({
      pass: 1,
      fail: 1,
      pending: 1,
      skipping: 0,
      cancel: 0,
    });
    expect(s.checks.map((c) => c.name)).toEqual(["test", "e2e"]);
  });

  it("lists every check with all", () => {
    expect(summarizeChecks(checks, true).checks).toHaveLength(3);
  });
});

describe("gh_pr_checks handler", () => {
  const handler = handlers.get("gh_pr_checks")!;
  beforeEach(() => execMock.mockReset());

  it("reads the JSON even though gh exits 1 on a failed check", async () => {
    execMock.mockResolvedValue({
      ...execOk(JSON.stringify([{ name: "t", bucket: "fail" }])),
      exitCode: 1,
    });
    const r = await handler({ pr: "12" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.counts.fail).toBe(1);
    expect(execMock.mock.lastCall?.[1]).toEqual([
      "pr",
      "checks",
      "12",
      "--json",
      "name,workflow,bucket,link",
    ]);
  });

  it("answers an error when there is no PR to check", async () => {
    execMock.mockResolvedValue({
      stdout: "",
      stderr: 'no pull requests found for branch "x"',
      exitCode: 1,
      timedOut: false,
    });
    const r = await handler({});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("no pull requests found");
  });
});

describe("gh_run_failure_summary handler", () => {
  const handler = handlers.get("gh_run_failure_summary")!;
  beforeEach(() => {
    execMock.mockReset();
    execJsonMock.mockReset();
  });

  it("finds the current branch's latest run and triages it", async () => {
    execMock
      .mockResolvedValueOnce(execOk("main\n")) // git rev-parse
      .mockResolvedValueOnce(execOk(LOG)); // --log-failed
    execJsonMock
      .mockResolvedValueOnce({
        data: [{ databaseId: 32299114656 }],
        error: null,
        exitCode: 0,
      })
      .mockResolvedValueOnce({ data: RUN, error: null, exitCode: 0 });
    const r = await handler({});
    expect(execJsonMock.mock.calls[0]?.[1]).toContain("main");
    expect(r.structuredContent.status).toBe("failure");
    expect(r.structuredContent.evidence).toHaveLength(1);
  });

  it("answers Unknown when the branch has no runs", async () => {
    execJsonMock.mockResolvedValueOnce({ data: [], error: null, exitCode: 0 });
    const r = await handler({ branch: "feature" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.status).toBe("Unknown");
    expect(r.structuredContent.evidence[0]).toContain("feature");
  });

  it("errors when gh is not authenticated", async () => {
    execJsonMock.mockResolvedValueOnce({
      data: null,
      error: "not logged in",
      exitCode: 1,
      detail: { kind: "not_authenticated", message: "not logged in" },
    });
    const r = await handler({ run: 1 });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.kind).toBe("not_authenticated");
  });
});
