/**
 * Tests for run tool.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { captureHandler } from "../../test-support.js";
import { registerRunTools } from "./run.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerRunTools(server);
  return server;
}

describe("registerRunTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});

describe("run", () => {
  const run = captureHandler(registerRunTools, "run");

  it("reports a binary that is not installed as missing_binary", async () => {
    const res = await run({
      command: "bash-mcp-no-such-binary",
      args: [],
      maxLines: 50,
      mode: "tail",
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent.error).toMatchObject({
      kind: "missing_binary",
    });
    expect(res.structuredContent.stderr).toContain("not installed");
  });
});
