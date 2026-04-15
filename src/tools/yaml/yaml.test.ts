/**
 * Tests for YAML tools (yq).
 */

import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerYamlTools } from "./yaml.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerYamlTools(server);
  return server;
}

describe("registerYamlTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});
