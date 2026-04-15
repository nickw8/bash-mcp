/**
 * Tests for search tools (rg, glob).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
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
