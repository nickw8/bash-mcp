/**
 * Tests for Helm tools (helm_list, helm_status, helm_values).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
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
