/**
 * Tests for Kubernetes tools (kube_get, kube_logs, kube_contexts).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureHandler } from "../../test-support.js";
import { registerKubeDiagnosticTools } from "./diagnostics.js";
import { registerKubernetesTools } from "./kubernetes.js";

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../exec.js")>();
  return { ...actual, execJson: vi.fn() };
});

const { execJson } = await import("#exec");
const execJsonMock = vi.mocked(execJson);

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

// ── Diagnostic tool handlers: the ADR-0005 decision ───────────────────
// A probe that never ran is an error; one that ran and failed is an Unknown
// triage; success is the classifier's answer.

const detail = (kind: string) => ({ kind, message: `${kind} happened` });
const never = (kind: "missing_binary" | "timeout") => ({
  data: null,
  error: `${kind} happened`,
  exitCode: 1,
  detail: detail(kind),
});
const failed = (kind: "command_failed" | "not_found") => ({
  data: null,
  error: `${kind} happened`,
  exitCode: 1,
  detail: detail(kind),
});
const noData = { data: null, error: null, exitCode: 0 };

const runningPod = {
  metadata: { name: "web-1", namespace: "qa" },
  status: { phase: "Running" },
};
const crashingPod = {
  metadata: { name: "web-2", namespace: "qa" },
  status: {
    phase: "Running",
    containerStatuses: [
      {
        name: "app",
        restartCount: 5,
        state: { waiting: { reason: "CrashLoopBackOff" } },
      },
    ],
  },
};

const cases = [
  {
    tool: "kube_diagnose_pod",
    args: { pod: "web-1", namespace: "qa" },
    wording: "kubectl get pod failed",
    ok: { data: crashingPod, error: null, exitCode: 0 },
    okStatus: "CrashLoopBackOff",
  },
  {
    tool: "kube_pod_failure_summary",
    args: { namespace: "qa" },
    wording: "kubectl get pods failed",
    ok: {
      data: { items: [runningPod, crashingPod] },
      error: null,
      exitCode: 0,
    },
    okStatus: "Unhealthy",
  },
  {
    tool: "kube_deployment_status",
    args: { name: "web", namespace: "qa" },
    wording: "kubectl get deployment failed",
    ok: {
      data: {
        metadata: { name: "web" },
        spec: { replicas: 2 },
        status: { replicas: 2, readyReplicas: 2, availableReplicas: 2 },
      },
      error: null,
      exitCode: 0,
    },
    okStatus: undefined,
  },
  {
    tool: "kube_events_summary",
    args: { namespace: "qa" },
    wording: "kubectl get events failed",
    ok: {
      data: {
        items: [
          {
            type: "Warning",
            reason: "BackOff",
            message: "Back-off restarting failed container",
            count: 3,
            involvedObject: { kind: "Pod", name: "web-2" },
          },
        ],
      },
      error: null,
      exitCode: 0,
    },
    okStatus: undefined,
  },
] as const;

describe.each(cases)("$tool handler", (c) => {
  const handler = captureHandler(registerKubeDiagnosticTools, c.tool);
  beforeEach(() => execJsonMock.mockReset());

  it.each([
    "missing_binary",
    "timeout",
  ] as const)("errors when the probe never ran (%s)", async (kind) => {
    execJsonMock.mockResolvedValue(never(kind));
    const res = await handler(c.args);
    expect(res.isError).toBe(true);
    expect(res.structuredContent.error.kind).toBe(kind);
  });

  it.each([
    "command_failed",
    "not_found",
  ] as const)("answers an Unknown triage when the probe ran and failed (%s)", async (kind) => {
    execJsonMock.mockResolvedValue(failed(kind));
    const res = await handler(c.args);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent.status).toBe("Unknown");
    expect(res.structuredContent.evidence[0]).toContain(c.wording);
    expect(res.structuredContent.evidence[0]).toContain(`${kind} happened`);
  });

  it("answers the classifier's output on success", async () => {
    execJsonMock.mockResolvedValue(c.ok);
    const res = await handler(c.args);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent.status).not.toBe("Unknown");
    if (c.okStatus) expect(res.structuredContent.status).toBe(c.okStatus);
    expect(res.structuredContent.evidence.length).toBeGreaterThan(0);
  });

  // Decided behaviour: no data is a probe that ran and failed. Kube hands `{}`
  // to its classifier today; only diagnosePod happens to read that as Unknown.
  // The others are marked `fails` until the fix set flips them.
  const noDataIt = c.tool === "kube_diagnose_pod" ? it : it.fails;
  noDataIt(
    "answers an Unknown triage when the probe gave no data",
    async () => {
      execJsonMock.mockResolvedValue(noData);
      const res = await handler(c.args);
      expect(res.isError).toBeUndefined();
      expect(res.structuredContent.status).toBe("Unknown");
    },
  );
});
