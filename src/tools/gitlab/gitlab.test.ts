/**
 * Tests for the GitLab tools: the pure parsers against a `glab ci get --output
 * json` pipeline and a `glab ci trace` (synthetic, in the shape of a real
 * failed secret-detection job), and both handlers with `exec`/`execJson` mocked.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureHandlers, execOk } from "../../test-support.js";
import {
  type GlabPipeline,
  summarizeJobs,
  traceTail,
  triagePipeline,
} from "./parse.js";

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../exec.js")>();
  return { ...actual, exec: vi.fn(), execJson: vi.fn() };
});

const { exec, execJson } = await import("#exec");
const execMock = vi.mocked(exec);
const execJsonMock = vi.mocked(execJson);
const { registerGitlabTools } = await import("./gitlab.js");
const handlers = captureHandlers(registerGitlabTools);

const FIXTURES = join(__dirname, "../../../fixtures/gitlab");
const PIPELINE: GlabPipeline = JSON.parse(
  readFileSync(join(FIXTURES, "pipeline-failed.json"), "utf8"),
);
const TRACE = readFileSync(join(FIXTURES, "trace-failed.txt"), "utf8");

describe("traceTail", () => {
  it("keeps the script's last output lines and the runner's verdict, not cleanup", () => {
    expect(traceTail(TRACE)).toEqual([
      "[INFO] [secrets] ▶ Running analyzer",
      "[INFO] [secrets] ▶ 12:33PM INF 6 commits scanned.",
      "[INFO] [secrets] ▶ 12:33PM INF scanned ~19385745 bytes (19.39 MB) in 455ms",
      "[INFO] [secrets] ▶ 12:33PM WRN leaks found: 18",
      "[INFO] [secrets] ▶ Creating report",
      "Secrets found; see the security report artifact or the merge request widget.",
      "ERROR: Job failed: command terminated with exit code 1",
    ]);
  });

  it("reads an old runner's trace: no timestamps, \\r-joined section markers", () => {
    const old =
      "\u001b[0Ksection_start:1:step_script\r\u001b[0K\u001b[0;m$ make\nboom\n" +
      "\u001b[0Ksection_end:2:step_script\r\u001b[0K\nERROR: Job failed: exit code 2\n";
    expect(traceTail(old)).toEqual(["boom", "ERROR: Job failed: exit code 2"]);
  });
});

describe("summarizeJobs", () => {
  it("counts every job and lists only the ones needing attention", () => {
    const s = summarizeJobs(PIPELINE);
    expect(s.counts).toEqual({ manual: 1, failed: 2, skipped: 1, success: 1 });
    expect(s.jobs.map((j) => j.name)).toEqual(["lint", "secrets"]);
    expect(summarizeJobs(PIPELINE, true).jobs).toHaveLength(5);
  });
});

describe("triagePipeline", () => {
  it("blames the failed job, not the one allowed to fail", () => {
    const t = triagePipeline(PIPELINE, new Map([[5003, TRACE]]));
    expect(t.status).toBe("failed");
    expect(t.failedJobs.map((j) => j.name)).toEqual(["secrets"]);
    expect(t.likelyCauses).toEqual([
      "Job 'secrets' (stage verify) failed: script_failure.",
      "Allowed to fail, not blocking: lint.",
    ]);
    expect(t.evidence).toContain(
      "secrets: Secrets found; see the security report artifact or the merge request widget.",
    );
  });

  it("emits exactly the benchmark fixture's payload", () => {
    const expected = readFileSync(
      join(
        FIXTURES,
        "../benchmarks/glab_pipeline_failure_summary/expected.txt",
      ),
      "utf8",
    );
    expect(
      JSON.stringify(triagePipeline(PIPELINE, new Map([[5003, TRACE]]))),
    ).toBe(expected);
  });

  it("reports a green pipeline as Healthy and a running one as InProgress", () => {
    expect(triagePipeline({ status: "success" }).status).toBe("Healthy");
    expect(triagePipeline({ status: "running" }).status).toBe(
      "InProgress (running)",
    );
  });
});

describe("glab_ci_status handler", () => {
  const handler = handlers.get("glab_ci_status")!;
  beforeEach(() => execJsonMock.mockReset());

  it("targets a merge request's head pipeline", async () => {
    execJsonMock.mockResolvedValue({
      data: PIPELINE,
      error: null,
      exitCode: 0,
    });
    const r = await handler({ mr: 42, repo: "acme/app" });
    expect(r.structuredContent.counts.failed).toBe(2);
    expect(execJsonMock.mock.lastCall?.[1]).toEqual([
      "ci",
      "get",
      "--output",
      "json",
      "--merge-request",
      "42",
      "-R",
      "acme/app",
    ]);
  });

  it("answers an error when there is no pipeline", async () => {
    execJsonMock.mockResolvedValue({
      data: null,
      error: "no pipeline found",
      exitCode: 1,
      detail: { kind: "command_failed", message: "no pipeline found" },
    });
    const r = await handler({});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("no pipeline found");
  });
});

describe("glab_pipeline_failure_summary handler", () => {
  const handler = handlers.get("glab_pipeline_failure_summary")!;
  beforeEach(() => {
    execMock.mockReset();
    execJsonMock.mockReset();
  });

  it("traces only the blocking failed job", async () => {
    execJsonMock.mockResolvedValue({
      data: PIPELINE,
      error: null,
      exitCode: 0,
    });
    execMock.mockResolvedValue(execOk(TRACE));
    const r = await handler({ pipeline: 1001 });
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.lastCall?.[1]).toEqual(["ci", "trace", "5003"]);
    expect(r.structuredContent.failedJobs).toHaveLength(1);
    expect(r.structuredContent.evidence.at(-1)).toBe(
      "secrets: ERROR: Job failed: command terminated with exit code 1",
    );
  });

  it("answers Unknown when glab ran but found nothing", async () => {
    execJsonMock.mockResolvedValue({
      data: null,
      error: "no pipeline found",
      exitCode: 1,
      detail: { kind: "command_failed", message: "no pipeline found" },
    });
    const r = await handler({ branch: "x" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.status).toBe("Unknown");
  });

  it("errors when glab is not authenticated", async () => {
    execJsonMock.mockResolvedValue({
      data: null,
      error: "not logged in",
      exitCode: 1,
      detail: { kind: "not_authenticated", message: "not logged in" },
    });
    const r = await handler({});
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.kind).toBe("not_authenticated");
  });
});
