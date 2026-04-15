/**
 * Tests for run tool.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
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
