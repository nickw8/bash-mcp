/**
 * Tool registry tests.
 *
 * What the registry claims: one record per registered tool, no duplicates across
 * repeated builds, and every tool tagged with its group's README category. How
 * that registry becomes docs — and the guards on the committed artifacts — is
 * src/docs/render.test.ts.
 */

import { describe, expect, it } from "vitest";
import { buildRegistry } from "./registry.js";

describe("buildRegistry", () => {
  it("returns one record per registered tool, deduplicated across calls", () => {
    const first = buildRegistry();
    const second = buildRegistry();
    expect(first.length).toBeGreaterThan(0);
    // resetRegistry inside buildRegistry prevents accumulation.
    expect(second.length).toBe(first.length);
    const names = first.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length); // unique names
  });

  it("includes the guidance + env discovery tools and seeded equivalentCommands", () => {
    const tools = buildRegistry();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.has("list_guidance")).toBe(true);
    expect(byName.has("check_environment")).toBe(true);
    // A representative seeded tool carries its raw-command equivalents.
    expect(byName.get("kube_diagnose_pod")?.equivalentCommands).toContain(
      "kubectl describe pod <pod> -n <ns>",
    );
  });

  it("tags every tool with its group's README category", () => {
    const tools = buildRegistry();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(tools.every((t) => typeof t.category === "string")).toBe(true);
    expect(byName.get("kube_get")?.category).toBe("Kubernetes");
    // Two register groups (git.ts + diff.ts) share the "Git" category.
    expect(byName.get("git_status")?.category).toBe("Git");
    expect(byName.get("git_diff_content")?.category).toBe("Git");
  });
});
