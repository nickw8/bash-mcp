/**
 * Tests for Terraform tools (tf_state_list, tf_show, tf_plan_summary, tf_workspaces).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerTerraformTools } from "./terraform.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerTerraformTools(server);
  return server;
}

describe("registerTerraformTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});
