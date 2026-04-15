/**
 * Tests for ArgoCD tools (argo_apps, argo_app_detail, argo_app_diff).
 */

import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerArgocdTools } from "./argocd.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerArgocdTools(server);
  return server;
}

describe("registerArgocdTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});
