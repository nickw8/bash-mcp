/**
 * Tests for Helm tools (helm_list, helm_status, helm_values).
 */

import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerHelmTools } from "./helm.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerHelmTools(server);
  return server;
}

describe("registerHelmTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});
