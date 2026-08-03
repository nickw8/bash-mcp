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

  // `detail` is the only place the raw spawn fields survive — callers pass it
  // to err() so the tool reports a kind and the wide event records errorKind.
  it("classifies a missing binary as missing_binary", async () => {
    const result = await execJson("definitely-not-a-real-binary-xyz", []);
    expect(result.detail?.kind).toBe("missing_binary");
  });

  it("classifies a timeout as timeout", async () => {
    const result = await execJson("sleep", ["10"], { timeout: 100 });
    expect(result.detail?.kind).toBe("timeout");
  });

  it("classifies unparseable stdout from a successful command as parse_failed", async () => {
    const result = await execJson("echo", ["not json"]);
    expect(result.detail?.kind).toBe("parse_failed");
    expect(result.detail?.command).toBe("echo");
  });

  it("leaves detail unset on success", async () => {
    const result = await execJson("echo", ["{}"]);
    expect(result.detail).toBeUndefined();
  });
});
