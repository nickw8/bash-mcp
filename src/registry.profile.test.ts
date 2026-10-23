import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  PROFILES,
  profileFromEnv,
  toolsInProfile,
} from "./registry.js";

describe("tool profiles", () => {
  const all = buildRegistry().map((t) => t.name);

  it("all registers every tool", () => {
    expect(toolsInProfile("all")).toEqual(all);
  });

  it("every profile includes core and result_get", () => {
    const core = toolsInProfile("core");
    expect(core).toContain("result_get");
    for (const p of PROFILES) {
      const names = toolsInProfile(p);
      for (const t of core) expect(names).toContain(t);
    }
  });

  it("splits infrastructure and development tools", () => {
    const infra = toolsInProfile("infrastructure");
    const dev = toolsInProfile("development");
    expect(infra).toContain("kube_diagnose_pod");
    expect(infra).not.toContain("npm_test");
    expect(dev).toContain("npm_test");
    expect(dev).not.toContain("kube_diagnose_pod");
    expect(toolsInProfile("core")).not.toContain("tf_plan_summary");
  });

  it("refuses an unknown profile", () => {
    expect(profileFromEnv(undefined)).toBe("all");
    expect(() => profileFromEnv("kube")).toThrow(/BASH_MCP_PROFILE=kube/);
  });
});
