/**
 * Tests for the run/batch safety profiles (BASH_MCP_MODE).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { checkCommandAllowed, classifyCommand, resolveMode } from "./safety.js";

// resolveMode() falls back to process.env.BASH_MCP_MODE, so tests that exercise
// the "unset" default must control the env explicitly — otherwise a dev session
// exporting BASH_MCP_MODE=off makes them fail. Restore after each test.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveMode", () => {
  it("defaults to readOnly when unset or unrecognized", () => {
    vi.stubEnv("BASH_MCP_MODE", undefined); // unset → default param resolves to readOnly
    expect(resolveMode()).toBe("readOnly");
    expect(resolveMode("")).toBe("readOnly");
    expect(resolveMode("nonsense")).toBe("readOnly");
  });
  it("maps known modes case-insensitively", () => {
    expect(resolveMode("readOnly")).toBe("readOnly");
    expect(resolveMode("confirmwrites")).toBe("confirmWrites");
    expect(resolveMode("DANGEROUS")).toBe("dangerous");
  });
  it("maps explicit off (the local opt-out)", () => {
    expect(resolveMode("off")).toBe("off");
    expect(resolveMode("OFF")).toBe("off");
  });
});

describe("classifyCommand", () => {
  it("classifies mutating subcommands as write", () => {
    expect(classifyCommand("kubectl", ["apply", "-f", "x"])).toBe("write");
    expect(classifyCommand("terraform", ["apply"])).toBe("write");
    expect(classifyCommand("helm", ["upgrade", "r", "c"])).toBe("write");
    expect(classifyCommand("git", ["push"])).toBe("write");
    expect(classifyCommand("rm", ["-rf", "/tmp/x"])).toBe("write");
  });

  it("classifies read subcommands of known binaries as read", () => {
    expect(classifyCommand("kubectl", ["get", "pods"])).toBe("read");
    expect(classifyCommand("terraform", ["plan"])).toBe("read");
    expect(classifyCommand("git", ["status"])).toBe("read");
    // sub-subcommands that are read are not false-flagged
    expect(classifyCommand("kubectl", ["rollout", "status"])).toBe("read");
    expect(classifyCommand("terraform", ["state", "list"])).toBe("read");
  });

  it("classifies unknown binaries as unknown", () => {
    expect(classifyCommand("node", ["script.js"])).toBe("unknown");
    expect(classifyCommand("echo", ["hi"])).toBe("unknown");
  });
});

describe("checkCommandAllowed", () => {
  it("never blocks when mode is off (the explicit opt-out)", () => {
    expect(checkCommandAllowed("kubectl", ["apply"], "off").allowed).toBe(true);
    expect(checkCommandAllowed("rm", ["-rf", "x"], "off").allowed).toBe(true);
  });

  it("blocks writes under the resolved default (unset → readOnly)", () => {
    vi.stubEnv("BASH_MCP_MODE", undefined); // ensure the default resolves independent of the shell
    expect(checkCommandAllowed("rm", ["-rf", "x"], resolveMode()).allowed).toBe(
      false,
    );
  });

  it("never blocks when mode is dangerous", () => {
    expect(
      checkCommandAllowed("terraform", ["destroy"], "dangerous").allowed,
    ).toBe(true);
  });

  it("blocks write commands under readOnly / confirmWrites", () => {
    const r = checkCommandAllowed(
      "kubectl",
      ["delete", "pod", "x"],
      "readOnly",
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("Blocked");
    expect(r.reason).toContain("Set BASH_MCP_MODE=off");
    expect(
      checkCommandAllowed("helm", ["uninstall", "r"], "confirmWrites").allowed,
    ).toBe(false);
  });

  it("allows read and unknown commands under readOnly", () => {
    expect(
      checkCommandAllowed("kubectl", ["get", "pods"], "readOnly").allowed,
    ).toBe(true);
    expect(checkCommandAllowed("node", ["x.js"], "readOnly").allowed).toBe(
      true,
    );
  });
});
