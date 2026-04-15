/**
 * Tests for search tools (rg, glob).
 */

import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTools } from "./search.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerSearchTools(server);
  return server;
}

describe("registerSearchTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});
