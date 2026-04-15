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
