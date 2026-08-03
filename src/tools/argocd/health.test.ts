/**
 * Fixture-driven tests for ArgoCD app health summarization.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { summarizeAppHealth } from "./health.js";
import type { ArgoApp } from "./payload.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/argocd",
);
function load(name: string): ArgoApp {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as ArgoApp;
}

describe("summarizeAppHealth", () => {
  it("flags a degraded, out-of-sync app with unhealthy resources as evidence", () => {
    const s = summarizeAppHealth(load("app-degraded.json"));
    expect(s.name).toBe("checkout");
    expect(s.status).toBe("Degraded");
    expect(s.syncStatus).toBe("OutOfSync");
    expect(s.healthy).toBe(false);
    expect(s.suggestedNextCommands).toContain("argo_app_diff");
    // the degraded Deployment shows up; the healthy Service does not
    expect(s.evidence.join(" ")).toContain("Deployment/checkout-api");
    expect(s.evidence.join(" ")).not.toContain("Service/checkout-api");
    // a comparison error condition is surfaced
    expect(s.evidence.join(" ")).toContain("ComparisonError");
    // the operation failure message becomes a likely cause
    expect(s.likelyCauses.join(" ")).toContain("failed to apply");
  });

  it("treats a synced + healthy app as healthy with no causes", () => {
    const s = summarizeAppHealth({
      metadata: { name: "ok" },
      status: {
        sync: { status: "Synced" },
        health: { status: "Healthy" },
        resources: [
          {
            kind: "Deployment",
            name: "ok",
            status: "Synced",
            health: { status: "Healthy" },
          },
        ],
      },
    });
    expect(s.healthy).toBe(true);
    expect(s.likelyCauses).toHaveLength(0);
    expect(s.evidence).toHaveLength(0);
  });

  it("never throws on an empty app object", () => {
    expect(() => summarizeAppHealth({})).not.toThrow();
    expect(summarizeAppHealth({}).status).toBe("Unknown");
  });
});
