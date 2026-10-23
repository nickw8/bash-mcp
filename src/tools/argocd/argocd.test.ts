/**
 * Tests for ArgoCD tools (argo_apps, argo_app_detail, argo_app_diff).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureHandler } from "../../test-support.js";
import { registerArgocdTools } from "./argocd.js";

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../exec.js")>();
  return { ...actual, execJson: vi.fn() };
});

const { execJson } = await import("#exec");
const execJsonMock = vi.mocked(execJson);

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

describe("argo_app_health_summary handler", () => {
  const handler = captureHandler(
    registerArgocdTools,
    "argo_app_health_summary",
  );
  const args = { name: "web" };
  const fail = (kind: string) => ({
    data: null,
    error: `${kind} happened`,
    exitCode: 1,
    detail: { kind, message: `${kind} happened` },
  });
  beforeEach(() => execJsonMock.mockReset());

  it.each([
    "missing_binary",
    "timeout",
  ])("errors when argocd never ran (%s)", async (kind) => {
    execJsonMock.mockResolvedValue(fail(kind) as never);
    const res = await handler(args);
    expect(res.isError).toBe(true);
    expect(res.structuredContent.error.kind).toBe(kind);
  });

  it.each([
    "command_failed",
    "not_found",
  ])("answers an Unknown triage when argocd ran and failed (%s)", async (kind) => {
    execJsonMock.mockResolvedValue(fail(kind) as never);
    const res = await handler(args);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toMatchObject({
      name: "web",
      syncStatus: "Unknown",
      healthy: false,
      status: "Unknown",
      suggestedNextCommands: ["argo_apps"],
    });
    expect(res.structuredContent.evidence[0]).toContain(
      "argocd app get failed",
    );
  });

  it("answers an Unknown triage when argocd gave no data", async () => {
    execJsonMock.mockResolvedValue({ data: null, error: null, exitCode: 0 });
    const res = await handler(args);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toMatchObject({
      name: "web",
      status: "Unknown",
    });
    expect(res.structuredContent.evidence[0]).toContain(
      "argocd app get failed: no data",
    );
  });

  it("answers the classifier's output on success", async () => {
    execJsonMock.mockResolvedValue({
      data: {
        metadata: { name: "web" },
        status: {
          sync: { status: "Synced" },
          health: { status: "Healthy" },
        },
      },
      error: null,
      exitCode: 0,
    });
    const res = await handler(args);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toMatchObject({
      name: "web",
      syncStatus: "Synced",
      healthy: true,
    });
  });
});
