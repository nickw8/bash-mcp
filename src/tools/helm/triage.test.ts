/**
 * Fixture-driven tests for helm release triage.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HelmStatus } from "./payload.js";
import { type HelmHistoryEntry, triageRelease } from "./triage.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/helm",
);
function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as T;
}

describe("triageRelease", () => {
  const status = load<HelmStatus>("status.json");
  const history = load<HelmHistoryEntry[]>("history.json");

  it("flags a failed release as unhealthy with the failure description", () => {
    const t = triageRelease(status, history);
    expect(t.status).toBe("failed");
    expect(t.healthy).toBe(false);
    expect(t.revision).toBe(5);
    expect(t.revisions).toBe(5);
    expect(t.likelyCauses.join(" ")).toContain("timed out");
    expect(
      t.suggestedNextCommands.some((c) => c.includes("kube_pod_failure")),
    ).toBe(true);
  });

  it("lists the most recent revisions first as evidence", () => {
    const t = triageRelease(status, history);
    expect(t.evidence).toHaveLength(5);
    expect(t.evidence[0]).toContain("rev 5 failed");
  });

  it("treats a deployed release as healthy", () => {
    const t = triageRelease({ version: 2, info: { status: "deployed" } }, [
      { revision: 1, status: "failed", description: "Upgrade failed" },
      { revision: 2, status: "deployed", description: "Rollback to 1" },
    ]);
    expect(t.healthy).toBe(true);
    // notes that an earlier revision failed before the healthy deploy
    expect(t.likelyCauses.join(" ")).toContain("earlier revision");
  });

  it("flags a stuck pending release", () => {
    const t = triageRelease({ info: { status: "pending-upgrade" } }, []);
    expect(t.healthy).toBe(false);
    expect(t.likelyCauses.join(" ").toLowerCase()).toContain("pending");
  });
});
