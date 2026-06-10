/**
 * Tests for the command execution layer.
 *
 * These tests run real commands (echo, cat, etc.) so they require
 * a unix-like environment. They verify the exec/execJson wrappers
 * handle exit codes, stdout/stderr, timeouts, and JSON parsing.
 */

import { afterEach, describe, expect, it } from "vitest";
import { exec, execJson, runStep, shapeOutput } from "./exec.js";

describe("exec", () => {
  it("captures stdout from a successful command", async () => {
    const result = await exec("echo", ["hello"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.stderr).toBe("");
  });

  it("captures stderr and non-zero exit code on failure", async () => {
    const result = await exec("ls", ["/nonexistent-path-that-does-not-exist"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("returns exit code 0 for a command that writes to stderr but succeeds", async () => {
    // Some commands write to stderr without failing
    const result = await exec("sh", ["-c", "echo warn >&2; echo ok"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
    expect(result.stderr.trim()).toBe("warn");
  });

  it("respects the cwd option", async () => {
    const result = await exec("pwd", [], { cwd: "/tmp" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("/tmp");
  });

  it("merges env option with process.env", async () => {
    const result = await exec("sh", ["-c", "echo $TEST_VAR_BASH_MCP"], {
      env: { TEST_VAR_BASH_MCP: "test-value" },
    });
    expect(result.stdout.trim()).toBe("test-value");
  });

  it("times out long-running commands", async () => {
    const result = await exec("sleep", ["10"], { timeout: 100 });
    // execFile returns SIGTERM kill which gives a non-zero exit
    expect(result.exitCode).not.toBe(0);
  });

  it("surfaces errorCode ENOENT for a missing binary", async () => {
    const result = await exec("definitely-not-a-real-binary-xyz", []);
    expect(result.exitCode).not.toBe(0);
    expect(result.errorCode).toBe("ENOENT");
    expect(result.timedOut).toBeFalsy();
  });

  it("flags timedOut when a command exceeds its timeout", async () => {
    const result = await exec("sleep", ["10"], { timeout: 100 });
    expect(result.timedOut).toBe(true);
  });

  it("leaves error fields unset on success", async () => {
    const result = await exec("echo", ["ok"]);
    expect(result.errorCode).toBeUndefined();
    expect(result.timedOut).toBeFalsy();
  });
});

describe("execJson", () => {
  it("parses valid JSON stdout", async () => {
    const result = await execJson<{ key: string }>("echo", ['{"key":"value"}']);
    expect(result.error).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(result.data).toEqual({ key: "value" });
  });

  it("returns error for non-zero exit code", async () => {
    const result = await execJson("ls", ["/nonexistent-path"]);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.exitCode).not.toBe(0);
  });

  it("returns error for invalid JSON", async () => {
    const result = await execJson("echo", ["not json"]);
    expect(result.data).toBeNull();
    expect(result.error).toContain("Failed to parse JSON");
  });

  it("parses JSON arrays", async () => {
    const result = await execJson<string[]>("echo", ['["a","b","c"]']);
    expect(result.data).toEqual(["a", "b", "c"]);
  });
});

describe("shapeOutput", () => {
  const text = "l1\nl2\nl3\nl4\nl5\n";

  it("returns all lines (newline-normalized) when under the limit", () => {
    const r = shapeOutput(text, { maxLines: 10 });
    expect(r.text).toBe("l1\nl2\nl3\nl4\nl5");
    expect(r.totalLines).toBe(5);
    expect(r.truncated).toBe(false);
  });

  it("keeps the last N lines in tail mode with a marker", () => {
    const r = shapeOutput(text, { mode: "tail", maxLines: 2 });
    expect(r.text).toBe("... (3 lines truncated) ...\nl4\nl5");
    expect(r.totalLines).toBe(5);
    expect(r.truncated).toBe(true);
  });

  it("keeps the first N lines in head mode with a trailing marker", () => {
    const r = shapeOutput(text, { mode: "head", maxLines: 2 });
    expect(r.text).toBe("l1\nl2\n... (3 lines truncated) ...");
    expect(r.truncated).toBe(true);
  });

  it("treats maxLines 0/undefined as unlimited", () => {
    expect(shapeOutput(text, { maxLines: 0 }).truncated).toBe(false);
    expect(shapeOutput(text).truncated).toBe(false);
  });

  it("caps bytes, keeping the trimmed end per mode", () => {
    const tail = shapeOutput("abcdefgh", { maxBytes: 3 });
    expect(tail.text).toBe("fgh");
    expect(tail.truncated).toBe(true);
    const head = shapeOutput("abcdefgh", { mode: "head", maxBytes: 3 });
    expect(head.text).toBe("abc");
  });

  it("handles empty output", () => {
    const r = shapeOutput("");
    expect(r.text).toBe("");
    expect(r.totalLines).toBe(0);
    expect(r.truncated).toBe(false);
  });
});

describe("runStep", () => {
  const original = process.env.BASH_MCP_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.BASH_MCP_MODE;
    else process.env.BASH_MCP_MODE = original;
  });

  it("runs an allowed command and reports elapsed + label", async () => {
    process.env.BASH_MCP_MODE = "readOnly";
    const r = await runStep({ command: "echo", args: ["hi"], label: "greet" });
    expect(r.blocked).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("hi");
    expect(r.label).toBe("greet");
    expect(r.elapsed).toBeGreaterThanOrEqual(0);
  });

  it("shapes step output through shapeOutput", async () => {
    process.env.BASH_MCP_MODE = "off";
    const r = await runStep(
      { command: "printf", args: ["a\\nb\\nc\\n"] },
      { mode: "tail", maxLines: 1 },
    );
    expect(r.stdout).toBe("... (2 lines truncated) ...\nc");
  });

  it("blocks a mutating command under readOnly without executing it", async () => {
    process.env.BASH_MCP_MODE = "readOnly";
    const r = await runStep({
      command: "rm",
      args: ["-rf", "/tmp/bash-mcp-x"],
    });
    expect(r.blocked).toBe(true);
    expect(r.exitCode).toBe(126);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("BASH_MCP_MODE");
    expect(r.elapsed).toBe(0);
  });
});
