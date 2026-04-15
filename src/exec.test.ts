/**
 * Tests for the command execution layer.
 *
 * These tests run real commands (echo, cat, etc.) so they require
 * a unix-like environment. They verify the exec/execJson wrappers
 * handle exit codes, stdout/stderr, timeouts, and JSON parsing.
 */

import { describe, expect, it } from "vitest";
import { exec, execJson } from "./exec.js";

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
