/**
 * Tests for the batch tool.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerBatchTools } from "./batch.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerBatchTools(server);
  return server;
}

describe("registerBatchTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});

describe("batch under readOnly", () => {
  // A composite call is gated per command, so bundling a write with reads
  // (or hiding it behind `sh -c`) does not get it past the mode.
  it("blocks the write and runs the read", async () => {
    const { Client } = await import(
      "@modelcontextprotocol/sdk/client/index.js"
    );
    const { InMemoryTransport } = await import(
      "@modelcontextprotocol/sdk/inMemory.js"
    );
    const previous = process.env.BASH_MCP_MODE;
    process.env.BASH_MCP_MODE = "readOnly";
    try {
      const server = createServer();
      const client = new Client({ name: "c", version: "0" });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(a), client.connect(b)]);
      const res = await client.callTool({
        name: "batch",
        arguments: {
          commands: [
            { command: "echo", args: ["hi"], label: "read" },
            {
              command: "rm",
              args: ["-rf", "/tmp/bash-mcp-batch-x"],
              label: "rm",
            },
            {
              command: "sh",
              args: ["-c", "rm -rf /tmp/bash-mcp-batch-y"],
              label: "sh",
            },
          ],
        },
      });
      const results = (
        res.structuredContent as {
          results: { label: string; exitCode: number }[];
        }
      ).results;
      const code = (l: string) => results.find((r) => r.label === l)?.exitCode;
      expect(code("read")).toBe(0);
      expect(code("rm")).toBe(126);
      expect(code("sh")).toBe(126);
    } finally {
      if (previous === undefined) delete process.env.BASH_MCP_MODE;
      else process.env.BASH_MCP_MODE = previous;
    }
  });
});
