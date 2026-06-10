/**
 * Tests for the run_seq tool.
 *
 * Beyond the registration smoke check, these exercise the genuinely new logic
 * versus batch: sequential execution, stopOnError short-circuiting, failedAt
 * computation, and per-step BASH_MCP_MODE gating (via the shared runStep).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpServer as RealMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { registerRunSeqTools } from "./seq.js";

function createServer() {
  const server = new RealMcpServer({ name: "test", version: "0.0.1" });
  registerRunSeqTools(server);
  return server;
}

interface RunSeqResult {
  structuredContent: {
    steps: { label: string; exitCode: number }[];
    exitCode: number;
    failedAt: number | null;
    elapsed: number;
  };
}

/** Capture the registered handler so we can invoke it directly. */
function getHandler(): (args: unknown) => Promise<RunSeqResult> {
  let handler: ((args: unknown) => Promise<RunSeqResult>) | undefined;
  const stub = {
    registerTool(
      _name: string,
      _config: unknown,
      h: (args: unknown) => Promise<RunSeqResult>,
    ) {
      handler = h;
    },
  } as unknown as McpServer;
  registerRunSeqTools(stub);
  if (!handler) throw new Error("run_seq handler was not registered");
  return handler;
}

describe("registerRunSeqTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});

describe("run_seq handler", () => {
  const original = process.env.BASH_MCP_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.BASH_MCP_MODE;
    else process.env.BASH_MCP_MODE = original;
  });

  it("runs every step in order when all succeed", async () => {
    process.env.BASH_MCP_MODE = "off";
    const handler = getHandler();
    const res = await handler({
      steps: [
        { command: "echo", args: ["one"], label: "a" },
        { command: "echo", args: ["two"], label: "b" },
      ],
      stopOnError: true,
      maxLines: 50,
    });
    expect(res.structuredContent.steps).toHaveLength(2);
    expect(res.structuredContent.steps.map((s) => s.label)).toEqual(["a", "b"]);
    expect(res.structuredContent.exitCode).toBe(0);
    expect(res.structuredContent.failedAt).toBeNull();
  });

  it("short-circuits on the first failure when stopOnError", async () => {
    process.env.BASH_MCP_MODE = "off";
    const handler = getHandler();
    const res = await handler({
      steps: [
        { command: "true", args: [], label: "ok" },
        { command: "false", args: [], label: "boom" },
        { command: "echo", args: ["never"], label: "skipped" },
      ],
      stopOnError: true,
      maxLines: 50,
    });
    expect(res.structuredContent.steps).toHaveLength(2);
    expect(res.structuredContent.failedAt).toBe(1);
    expect(res.structuredContent.exitCode).not.toBe(0);
  });

  it("runs all steps when stopOnError is false, reporting first failure", async () => {
    process.env.BASH_MCP_MODE = "off";
    const handler = getHandler();
    const res = await handler({
      steps: [
        { command: "false", args: [], label: "first-fail" },
        { command: "echo", args: ["still-runs"], label: "after" },
      ],
      stopOnError: false,
      maxLines: 50,
    });
    expect(res.structuredContent.steps).toHaveLength(2);
    expect(res.structuredContent.failedAt).toBe(0);
  });

  it("blocks a mutating step under readOnly with exitCode 126", async () => {
    process.env.BASH_MCP_MODE = "readOnly";
    const handler = getHandler();
    const res = await handler({
      steps: [{ command: "rm", args: ["-rf", "/tmp/bash-mcp-seq-x"] }],
      stopOnError: true,
      maxLines: 50,
    });
    expect(res.structuredContent.steps[0]?.exitCode).toBe(126);
    expect(res.structuredContent.failedAt).toBe(0);
  });
});
