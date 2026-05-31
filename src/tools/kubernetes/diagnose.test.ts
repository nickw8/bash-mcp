/**
 * Fixture-driven tests for pod-failure classification (diagnosePod).
 *
 * Each fixture is a real `kubectl get pod -o json` shape for a failure mode.
 * Assertions check the primary status, that a relevant cause/suggestion and
 * evidence are produced, and that malformed input is handled safely.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  diagnoseDeployment,
  diagnosePod,
  type KubeEvent,
  summarizeEvents,
} from "./diagnose.js";
import type { KubeResource } from "./parse.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/kubectl",
);
function pod(name: string): KubeResource {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as KubeResource;
}

describe("diagnosePod", () => {
  it("classifies CrashLoopBackOff", () => {
    const d = diagnosePod(pod("pod-crashloop.json"));
    expect(d.status).toBe("CrashLoopBackOff");
    expect(d.evidence.join(" ")).toContain("CrashLoopBackOff");
    expect(d.likelyCauses.join(" ").toLowerCase()).toContain("logs");
    expect(d.suggestedNextCommands.some((c) => c.startsWith("kube_logs"))).toBe(
      true,
    );
  });

  it("classifies ImagePullBackOff with the image in evidence", () => {
    const d = diagnosePod(pod("imagepullbackoff.json"));
    expect(d.status).toBe("ImagePullBackOff");
    expect(d.evidence.join(" ")).toContain("nginx:doesnotexist");
  });

  it("classifies OOMKilled from lastState", () => {
    const d = diagnosePod(pod("pod-oomkilled.json"));
    expect(d.status).toBe("OOMKilled");
    expect(d.evidence.join(" ")).toContain("OOMKilled");
    expect(d.likelyCauses.join(" ").toLowerCase()).toContain("memory");
  });

  it("classifies an unschedulable Pending pod", () => {
    const d = diagnosePod(pod("pod-unschedulable.json"));
    expect(d.status).toBe("Unschedulable");
    expect(d.evidence.join(" ")).toContain("Insufficient cpu");
  });

  it("falls back to phase for a healthy pod and reports no causes", () => {
    const healthy: KubeResource = {
      metadata: { name: "ok", namespace: "default" },
      status: {
        phase: "Running",
        containerStatuses: [{ name: "c", ready: true, restartCount: 0 }],
      },
    };
    const d = diagnosePod(healthy);
    expect(d.status).toBe("Running");
    expect(d.likelyCauses).toHaveLength(0);
    expect(d.evidence).toHaveLength(0);
  });

  it("never throws on malformed input", () => {
    expect(() => diagnosePod({})).not.toThrow();
    expect(diagnosePod({}).status).toBe("Unknown");
  });
});

describe("summarizeEvents (fixtures/kubectl/events.json)", () => {
  const list = JSON.parse(
    readFileSync(join(fixtures, "events.json"), "utf8"),
  ) as { items: KubeEvent[] };

  it("keeps only Warning events, ordered by count", () => {
    const d = summarizeEvents(list.items);
    expect(d.status).toBe("Warning");
    expect(d.evidence).toHaveLength(2);
    expect(d.evidence[0]).toContain("BackOff x12"); // highest count first
    expect(d.evidence.join(" ")).not.toContain("Pulled"); // Normal dropped
  });

  it("reports OK with no warnings", () => {
    const d = summarizeEvents([{ type: "Normal", reason: "Pulled" }]);
    expect(d.status).toBe("OK");
    expect(d.evidence).toHaveLength(0);
  });
});

describe("diagnoseDeployment", () => {
  it("flags a degraded deployment (fixtures/kubectl/deployment-degraded.json)", () => {
    const dep = JSON.parse(
      readFileSync(join(fixtures, "deployment-degraded.json"), "utf8"),
    ) as KubeResource;
    const d = diagnoseDeployment(dep);
    expect(d.status).toBe("Degraded");
    expect(d.evidence[0]).toBe("1/3 replicas ready");
    expect(d.evidence.join(" ")).toContain("Available=False");
  });

  it("reports Available when replicas are satisfied", () => {
    const dep: KubeResource = {
      metadata: { name: "ok", namespace: "default" },
      spec: { replicas: 2 },
      status: { replicas: 2, readyReplicas: 2, availableReplicas: 2 },
    };
    expect(diagnoseDeployment(dep).status).toBe("Available");
  });
});
