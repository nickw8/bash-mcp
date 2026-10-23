/**
 * Tests for npm tool registration. Parser tests are co-located with the
 * parsers in ./parsers/*.test.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { captureHandler, execOk } from "../../test-support.js";

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#exec")>();
  return { ...actual, exec: vi.fn() };
});

const { exec } = await import("#exec");
const execMock = vi.mocked(exec);
const { registerNpmTools } = await import("./npm.js");

describe("registerNpmTools", () => {
  it("registers without throwing", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    expect(() => registerNpmTools(server)).not.toThrow();
  });
});

// Real `biome check --fix --reporter=json` (2.4.11): the fixed-file count is
// summary.changed; there is no "Fixed N files" line.
const FIXED_RUN = JSON.stringify({
  summary: { changed: 2, unchanged: 2, matches: 0, errors: 0, warnings: 1 },
  diagnostics: [
    {
      severity: "warning",
      message: "Forbidden non-null assertion.",
      category: "lint/style/noNonNullAssertion",
      location: {
        path: "src/app.ts",
        start: { line: 7, column: 10 },
        end: { line: 7, column: 12 },
      },
      advices: [],
    },
  ],
  command: "check",
});

describe("npm_lint fixedCount", () => {
  const lint = captureHandler(registerNpmTools, "npm_lint");

  it("is summary.changed when fix was requested", async () => {
    execMock.mockResolvedValue({ ...execOk(FIXED_RUN), exitCode: 1 });
    const r = await lint({ cwd: ".", fix: true });
    expect(r.structuredContent).toMatchObject({
      errorCount: 0,
      warningCount: 1,
      fixedCount: 2,
    });
  });

  it("is 0 when fix was not requested", async () => {
    execMock.mockResolvedValue({ ...execOk(FIXED_RUN), exitCode: 1 });
    const r = await lint({ cwd: "." });
    expect(r.structuredContent).toMatchObject({ fixedCount: 0 });
  });
});
