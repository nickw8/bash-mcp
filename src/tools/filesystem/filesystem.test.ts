/**
 * Tests for filesystem tools (ls, tree, du, find_files).
 *
 * Uses real filesystem commands since ls/find/du are universally available.
 */

import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFilesystemTools } from "./filesystem.js";

/** Helper to create a server with filesystem tools registered. */
function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerFilesystemTools(server);
  return server;
}

describe("registerFilesystemTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});
