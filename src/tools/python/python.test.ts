/**
 * Tests for python tool registration. Parser tests are co-located with the
 * parsers in ./parsers/*.test.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { captureHandler } from "../../test-support.js";

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#exec")>();
  return { ...actual, exec: vi.fn() };
});

const { exec } = await import("#exec");
const execMock = vi.mocked(exec);
const { registerPythonTools } = await import("./python.js");

describe("registerPythonTools", () => {
  it("registers without throwing", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    expect(() => registerPythonTools(server)).not.toThrow();
  });
});

describe("python_lint with ruff missing", () => {
  it("answers a missing_binary error, not zero errors", async () => {
    execMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 1,
      errorCode: "ENOENT",
    });
    const result = await captureHandler(
      registerPythonTools,
      "python_lint",
    )({ cwd: "/p" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { kind: "missing_binary", command: "ruff" },
    });
  });
});

// Real `ruff check --fix --output-format json` (0.17.1) prints only the
// remaining findings, or `[]` when all were fixed; no fixed count in JSON mode.
describe("python_lint fixedCount", () => {
  it("stays 0 after a clean --fix run", async () => {
    execMock.mockResolvedValue({
      stdout: "[]",
      stderr: "",
      exitCode: 0,
    });
    const r = await captureHandler(
      registerPythonTools,
      "python_lint",
    )({ cwd: "/p", fix: true });
    expect(r.structuredContent).toMatchObject({
      errorCount: 0,
      warningCount: 0,
      fixedCount: 0,
    });
  });
});
