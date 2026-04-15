/**
 * Tests for file tools (cat).
 *
 * Uses real filesystem commands since cat/head/sed are universally available.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerFileTools } from "./file.js";

/** Helper to create a server with file tools registered. */
function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerFileTools(server);
  return server;
}

describe("registerFileTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});
