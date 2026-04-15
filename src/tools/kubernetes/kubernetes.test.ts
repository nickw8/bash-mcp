/**
 * Tests for Kubernetes tools (kube_get, kube_logs, kube_contexts).
 */

import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerKubernetesTools } from "./kubernetes.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerKubernetesTools(server);
  return server;
}

describe("registerKubernetesTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});
