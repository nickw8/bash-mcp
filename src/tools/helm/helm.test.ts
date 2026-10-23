/**
 * Tests for Helm tools (helm_list, helm_status, helm_values).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureHandler } from "../../test-support.js";
import { registerHelmTools } from "./helm.js";

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../exec.js")>();
  return { ...actual, execJson: vi.fn() };
});

const { execJson } = await import("#exec");
const execJsonMock = vi.mocked(execJson);

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

describe("helm_release_triage handler", () => {
  const handler = captureHandler(registerHelmTools, "helm_release_triage");
  const args = { release: "web", namespace: "qa" };
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
  ])("errors when helm never ran (%s)", async (kind) => {
    execJsonMock.mockResolvedValue(fail(kind) as never);
    const res = await handler(args);
    expect(res.isError).toBe(true);
    expect(res.structuredContent.error.kind).toBe(kind);
  });

  it.each([
    "command_failed",
    "not_found",
  ])("answers an Unknown triage when helm ran and failed (%s)", async (kind) => {
    execJsonMock.mockResolvedValue(fail(kind) as never);
    const res = await handler(args);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toMatchObject({
      status: "Unknown",
      healthy: false,
      revision: 0,
      revisions: 0,
      suggestedNextCommands: ["helm_list namespace=qa"],
    });
    expect(res.structuredContent.evidence[0]).toContain("helm status failed");
  });

  it("answers an Unknown triage when helm gave no data", async () => {
    execJsonMock.mockResolvedValue({
      data: null,
      error: null,
      exitCode: 0,
    });
    const res = await handler(args);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent.status).toBe("Unknown");
    expect(res.structuredContent.evidence[0]).toContain("helm status: no data");
  });

  it("answers the classifier's output on success", async () => {
    execJsonMock
      .mockResolvedValueOnce({
        data: { name: "web", version: 3, info: { status: "deployed" } },
        error: null,
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        data: [{ revision: 3, status: "deployed" }],
        error: null,
        exitCode: 0,
      });
    const res = await handler(args);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent.status).not.toBe("Unknown");
    expect(res.structuredContent.revision).toBe(3);
  });

  it("still answers when the best-effort history fails", async () => {
    execJsonMock
      .mockResolvedValueOnce({
        data: { name: "web", version: 3, info: { status: "deployed" } },
        error: null,
        exitCode: 0,
      })
      .mockResolvedValueOnce(fail("timeout") as never);
    const res = await handler(args);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent.revision).toBe(3);
  });
});
