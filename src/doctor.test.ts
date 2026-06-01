/**
 * Tests for the --doctor preflight diagnostics.
 *
 * The pure functions (`exitCodeFor`, `formatReport`) are tested directly, and
 * `runDoctor` is driven through injected deps so each branch (old Node, SDK
 * import failure, missing CLIs, mode recommendation) is exercised without
 * touching the real environment or `process.exit`.
 */

import { describe, expect, it } from "vitest";
import { type Check, exitCodeFor, formatReport, runDoctor } from "./doctor.js";

const ok = (name: string, critical = false): Check => ({
  name,
  ok: true,
  critical,
});
const fail = (name: string, critical: boolean): Check => ({
  name,
  ok: false,
  critical,
});

describe("exitCodeFor", () => {
  it("returns 1 when a critical check fails", () => {
    expect(exitCodeFor([ok("a", true), fail("b", true)])).toBe(1);
  });

  it("returns 0 when only non-critical checks fail", () => {
    expect(exitCodeFor([ok("a", true), fail("cli: yq", false)])).toBe(0);
  });

  it("returns 0 when all checks pass", () => {
    expect(exitCodeFor([ok("a", true), ok("b", false)])).toBe(0);
  });
});

describe("formatReport", () => {
  it("renders a header, a marked line per check, and a summary", () => {
    const report = formatReport([
      ok("Node.js", true),
      fail("MCP SDK", true),
      fail("cli: yq", false),
    ]);
    expect(report).toContain("bash-mcp doctor");
    expect(report).toContain("✓ Node.js");
    expect(report).toContain("✗ MCP SDK"); // critical failure
    expect(report).toContain("• cli: yq"); // advisory failure
    expect(report).toContain("FAIL: 1 critical check(s) failed.");
  });

  it("reports success when no critical check fails", () => {
    expect(
      formatReport([ok("Node.js", true), fail("cli: yq", false)]),
    ).toContain("OK: all critical checks passed.");
  });
});

describe("runDoctor", () => {
  const baseDeps = {
    nodeVersion: "20.11.1",
    probes: [{ name: "git", binary: "git", versionArgs: ["--version"] }],
    probe: async () => ({ name: "git", installed: true, version: "2.39.5" }),
    distEntry: "/pkg/dist/index.js",
    fileExists: () => true,
    importSdk: async () => ({}),
    mode: "readOnly" as const,
    path: "/usr/bin",
  };

  it("covers every check category", async () => {
    const { checks } = await runDoctor(baseDeps);
    const names = checks.map((c) => c.name);
    expect(names).toContain("Node.js");
    expect(names).toContain("dist entry");
    expect(names).toContain("MCP SDK");
    expect(names).toContain("PATH");
    expect(names).toContain("cli: git");
    expect(names).toContain("BASH_MCP_MODE");
  });

  it("passes (exit 0) in a healthy environment", async () => {
    const { exitCode } = await runDoctor(baseDeps);
    expect(exitCode).toBe(0);
  });

  it("fails (exit 1) on a too-old Node", async () => {
    const { checks, exitCode } = await runDoctor({
      ...baseDeps,
      nodeVersion: "18.19.0",
    });
    expect(exitCode).toBe(1);
    expect(checks.find((c) => c.name === "Node.js")?.ok).toBe(false);
  });

  it("fails (exit 1) when the MCP SDK import throws", async () => {
    const { checks, exitCode } = await runDoctor({
      ...baseDeps,
      importSdk: async () => {
        throw new Error("Cannot find module");
      },
    });
    expect(exitCode).toBe(1);
    const sdk = checks.find((c) => c.name === "MCP SDK");
    expect(sdk?.ok).toBe(false);
    expect(sdk?.detail).toContain("Cannot find module");
  });

  it("treats a missing CLI as advisory, not a failure", async () => {
    const { checks, exitCode } = await runDoctor({
      ...baseDeps,
      probe: async () => ({ name: "git", installed: false }),
    });
    expect(exitCode).toBe(0);
    const cli = checks.find((c) => c.name === "cli: git");
    expect(cli).toMatchObject({
      ok: false,
      critical: false,
      detail: "not found",
    });
  });

  it("treats an absent dist build as advisory (e.g. running from source)", async () => {
    const { checks, exitCode } = await runDoctor({
      ...baseDeps,
      fileExists: () => false,
    });
    expect(exitCode).toBe(0);
    const dist = checks.find((c) => c.name === "dist entry");
    expect(dist).toMatchObject({ ok: false, critical: false });
    expect(dist?.detail).toContain("npm run build");
  });

  it("flags a non-recommended mode in the detail", async () => {
    const { checks } = await runDoctor({ ...baseDeps, mode: "off" });
    expect(checks.find((c) => c.name === "BASH_MCP_MODE")?.detail).toBe(
      "off (recommended: readOnly)",
    );
  });
});
