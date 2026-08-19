/**
 * Tests for the structured error taxonomy (classifyError).
 *
 * classifyError maps a (partial) ExecResult plus the command name into a
 * machine-readable ToolError so agents can decide how to recover (install
 * a binary, re-authenticate, retry, fix input). These use synthetic
 * ExecResults — no real processes.
 */

import { describe, expect, it } from "vitest";
import { classifyError, TOOL_ERROR_KINDS } from "./error.js";
import type { ExecResult } from "./exec.js";

function res(over: Partial<ExecResult>): ExecResult {
  return { stdout: "", stderr: "", exitCode: 1, ...over };
}

describe("classifyError", () => {
  it("ENOENT → missing_binary with a suggestion and the command", () => {
    const e = classifyError(res({ errorCode: "ENOENT" }), "kubectl");
    expect(e.kind).toBe("missing_binary");
    expect(e.command).toBe("kubectl");
    expect(e.suggestion).toBeTruthy();
  });

  it("E2BIG → invalid_input, suggesting stdin or a file", () => {
    const e = classifyError(res({ errorCode: "E2BIG" }), "rg");
    expect(e.kind).toBe("invalid_input");
    expect(e.suggestion).toMatch(/stdin/);
    expect(e.suggestion).toMatch(/file/);
    // Not the generic invalid_input advice — retrying the same argv is futile.
    expect(e.suggestion).not.toMatch(/Check the command arguments/);
  });

  it("timedOut → timeout", () => {
    expect(classifyError(res({ timedOut: true }), "sleep").kind).toBe(
      "timeout",
    );
  });

  it("unauthorized stderr → not_authenticated", () => {
    const e = classifyError(
      res({
        stderr: "error: You must be logged in to the server (Unauthorized)",
      }),
      "kubectl get",
    );
    expect(e.kind).toBe("not_authenticated");
  });

  it("forbidden stderr → permission_denied", () => {
    const e = classifyError(
      res({
        stderr: 'pods is forbidden: User "x" cannot list resource "pods"',
      }),
      "kubectl get",
    );
    expect(e.kind).toBe("permission_denied");
  });

  it("not found stderr → not_found", () => {
    const e = classifyError(
      res({ stderr: 'Error from server (NotFound): pods "x" not found' }),
      "kubectl get",
    );
    expect(e.kind).toBe("not_found");
  });

  it("unrecognized stderr → command_failed", () => {
    const e = classifyError(res({ stderr: "boom: something broke" }), "git");
    expect(e.kind).toBe("command_failed");
  });

  it("missing_binary takes precedence over stderr text", () => {
    const e = classifyError(
      res({ errorCode: "ENOENT", stderr: "not found" }),
      "tofu",
    );
    expect(e.kind).toBe("missing_binary");
  });

  it("carries the exit code through", () => {
    const e = classifyError(res({ exitCode: 127, stderr: "x" }), "git");
    expect(e.exitCode).toBe(127);
  });

  it("every kind is a member of TOOL_ERROR_KINDS", () => {
    const samples: ExecResult[] = [
      res({ errorCode: "ENOENT" }),
      res({ timedOut: true }),
      res({ stderr: "Unauthorized" }),
      res({ stderr: "forbidden" }),
      res({ stderr: "not found" }),
      res({ stderr: "whatever" }),
    ];
    for (const s of samples) {
      expect(TOOL_ERROR_KINDS).toContain(classifyError(s, "x").kind);
    }
  });
});
