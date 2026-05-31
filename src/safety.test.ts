/**
 * Tests for the run/batch safety profiles (BASH_MCP_MODE).
 */

import { describe, expect, it } from "vitest";
import { checkCommandAllowed, classifyCommand, resolveMode } from "./safety.js";

describe("resolveMode", () => {
  it("defaults to off when unset or unrecognized", () => {
    expect(resolveMode(undefined)).toBe("off");
    expect(resolveMode("")).toBe("off");
    expect(resolveMode("nonsense")).toBe("off");
  });
  it("maps known modes case-insensitively", () => {
    expect(resolveMode("readOnly")).toBe("readOnly");
    expect(resolveMode("confirmwrites")).toBe("confirmWrites");
    expect(resolveMode("DANGEROUS")).toBe("dangerous");
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
  it("never blocks when mode is off (default)", () => {
    expect(checkCommandAllowed("kubectl", ["apply"], "off").allowed).toBe(true);
    expect(checkCommandAllowed("rm", ["-rf", "x"], "off").allowed).toBe(true);
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
