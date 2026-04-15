/**
 * Tests for git tools (git_status, git_log, git_diff, git_branches).
 */

import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGitTools } from "./git.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerGitTools(server);
  return server;
}

describe("registerGitTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});
