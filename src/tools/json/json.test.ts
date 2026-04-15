/**
 * Tests for JSON tools (jq).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerJsonTools } from "./json.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerJsonTools(server);
  return server;
}

describe("registerJsonTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});
