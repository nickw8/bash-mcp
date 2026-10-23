/**
 * Fixture-driven tests for the pure Kubernetes parsers.
 *
 * summarizeResource is exercised against real `kubectl get -o json` shape from
 * fixtures/kubectl/pods.json; the log/context parsers use inline samples. No
 * cluster, no network.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type ContainerState,
  type ContainerStatus,
  type KubeList,
  type KubeResource,
  parseContexts,
  parseLogLines,
  podStatus,
  summarizeResource,
} from "./parse.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/kubectl",
);
function fixture(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

describe("summarizeResource (fixtures/kubectl/pods.json)", () => {
  const list = JSON.parse(fixture("pods.json")) as KubeList;
  const items = list.items.map(summarizeResource);

  it("summarizes a running pod with restart count", () => {
    const web = items[0]!;
    expect(web.name).toBe("web-7d9f");
    expect(web.namespace).toBe("default");
    expect(web.status).toBe("Running");
    expect(web.extra.kind).toBe("Pod");
    expect(web.extra.restarts).toBe("3");
    expect(web.labels).toEqual({ app: "web" });
  });

  it("summarizes a pending pod", () => {
    const db = items[1]!;
    expect(db.name).toBe("db-0");
    expect(db.namespace).toBe("data");
    expect(db.status).toBe("Pending");
    expect(db.extra.restarts).toBeUndefined();
  });

  it("summarizes a deployment with replica ratio", () => {
    const api = items[2]!;
    expect(api.extra.replicas).toBe("2/3");
  });

  it("never throws on an empty resource", () => {
    expect(() => summarizeResource({})).not.toThrow();
    expect(summarizeResource({}).status).toBe("Unknown");
  });
});

describe("podStatus (kubectl printPod STATUS)", () => {
  const c = (state: ContainerState, ready = false): ContainerStatus => ({
    name: "app",
    ready,
    restartCount: 0,
    state,
  });
  const pod = (status: KubeResource["status"], deleting = false) => ({
    metadata: deleting ? { deletionTimestamp: "2026-10-23T00:00:00Z" } : {},
    status,
  });

  it.each<[string, KubeResource, string]>([
    [
      "crash loop under a Running phase",
      pod({
        phase: "Running",
        containerStatuses: [c({ waiting: { reason: "CrashLoopBackOff" } })],
      }),
      "CrashLoopBackOff",
    ],
    [
      "terminated reason",
      pod({
        phase: "Running",
        containerStatuses: [
          c({ terminated: { reason: "Error", exitCode: 1 } }),
        ],
      }),
      "Error",
    ],
    [
      "terminated by signal with no reason",
      pod({
        phase: "Running",
        containerStatuses: [c({ terminated: { exitCode: 137, signal: 9 } })],
      }),
      "Signal:9",
    ],
    [
      "terminated with no reason or signal",
      pod({
        phase: "Running",
        containerStatuses: [c({ terminated: { exitCode: 2 } })],
      }),
      "ExitCode:2",
    ],
    [
      "failing init container",
      pod({
        phase: "Pending",
        initContainerStatuses: [
          c({ terminated: { reason: "Error", exitCode: 1 } }),
        ],
      }),
      "Init:Error",
    ],
    [
      "init container waiting on a pull",
      pod({
        phase: "Pending",
        initContainerStatuses: [c({ waiting: { reason: "ErrImagePull" } })],
      }),
      "Init:ErrImagePull",
    ],
    [
      "second of two init containers running",
      pod({
        phase: "Pending",
        initContainerStatuses: [
          c({ terminated: { exitCode: 0 } }),
          c({ running: {} }),
        ],
      }),
      "Init:1/2",
    ],
    [
      "completed sidecar beside a running container",
      pod({
        phase: "Running",
        containerStatuses: [
          c({ running: {} }, true),
          c({ terminated: { reason: "Completed", exitCode: 0 } }),
        ],
      }),
      "Running",
    ],
    [
      "pod reason over phase",
      pod({ phase: "Failed", reason: "Evicted" }),
      "Evicted",
    ],
    [
      "deleting",
      pod(
        { phase: "Running", containerStatuses: [c({ running: {} }, true)] },
        true,
      ),
      "Terminating",
    ],
    [
      "deleting on a lost node",
      pod({ phase: "Running", reason: "NodeLost" }, true),
      "Unknown",
    ],
  ])("%s", (_, input, want) => {
    expect(podStatus(input)).toBe(want);
  });

  it("is what summarizeResource reports for a pod", () => {
    const item: KubeResource = {
      kind: "Pod",
      ...pod({
        phase: "Running",
        containerStatuses: [c({ waiting: { reason: "CrashLoopBackOff" } })],
      }),
    };
    expect(summarizeResource(item).status).toBe("CrashLoopBackOff");
  });
});

describe("parseLogLines", () => {
  it("splits RFC3339 timestamp from the message", () => {
    const out = parseLogLines(
      "2024-01-01T00:00:00Z hello world\n2024-01-01T00:00:01Z second line",
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      timestamp: "2024-01-01T00:00:00Z",
      message: "hello world",
    });
  });

  it("treats non-timestamped lines as message-only", () => {
    const out = parseLogLines("no timestamp here");
    expect(out[0]).toEqual({ timestamp: "", message: "no timestamp here" });
  });

  it("drops blank lines and handles empty input", () => {
    expect(parseLogLines("")).toEqual([]);
    expect(parseLogLines("\n\n")).toEqual([]);
  });
});

describe("parseContexts", () => {
  it("parses get-contexts output and marks the current context", () => {
    const out = parseContexts(
      "*         prod   prod-cluster   admin   kube-system\n          dev    dev-cluster    admin   default",
    );
    expect(out.current).toBe("prod");
    expect(out.contexts).toHaveLength(2);
    expect(out.contexts[0]).toEqual({
      name: "prod",
      cluster: "prod-cluster",
      namespace: "kube-system",
      current: true,
    });
    expect(out.contexts[1]!.current).toBe(false);
  });
});
