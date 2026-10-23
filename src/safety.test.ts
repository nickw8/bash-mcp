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

  it("finds the subcommand behind global flags and their values", () => {
    expect(
      classifyCommand("kubectl", ["-n", "prod", "delete", "pod", "x"]),
    ).toBe("write");
    expect(
      classifyCommand("kubectl", ["--context=qa", "apply", "-f", "x"]),
    ).toBe("write");
    expect(classifyCommand("git", ["-C", "repo", "push"])).toBe("write");
    expect(classifyCommand("git", ["--no-pager", "push"])).toBe("write");
    expect(classifyCommand("terraform", ["-chdir=infra", "destroy"])).toBe(
      "write",
    );
    expect(
      classifyCommand("helm", ["--kube-context", "qa", "upgrade", "r", "c"]),
    ).toBe("write");
    expect(classifyCommand("kubectl", ["-n", "prod", "get", "pods"])).toBe(
      "read",
    );
    // an argument after the subcommand is not mistaken for one
    expect(classifyCommand("kubectl", ["get", "pod", "delete"])).toBe("read");
    expect(classifyCommand("git", ["--no-pager", "log", "-p"])).toBe("read");
  });

  it("classifies a binary given by path by its basename", () => {
    expect(
      classifyCommand("/usr/local/bin/kubectl", ["delete", "pod", "x"]),
    ).toBe("write");
    expect(classifyCommand("/bin/rm", ["x"])).toBe("write");
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

  it("names the mutating subcommand behind global flags", () => {
    const r = checkCommandAllowed(
      "/usr/local/bin/kubectl",
      ["-n", "prod", "delete", "pod", "x"],
      "readOnly",
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("'kubectl delete'");
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

describe("commands run through a shell, wrapper or find", () => {
  const blocked = (command: string, args: string[]) =>
    checkCommandAllowed(command, args, "readOnly").reason;

  it("classifies each command in a sh -c script", () => {
    expect(blocked("sh", ["-c", "kubectl -n prod delete pod x"])).toContain(
      "'kubectl delete'",
    );
    expect(blocked("bash", ["-lc", "git status && git push"])).toContain(
      "'git push'",
    );
    expect(blocked("sh", ["-c", "ls | xargs rm"])).toContain("'rm'");
    expect(blocked("sh", ["-c", "echo $(rm x)"])).toContain("'rm'");
    expect(blocked("sh", ["-c", "FOO=1 terraform destroy"])).toContain(
      "'terraform destroy'",
    );
    expect(blocked("sh", ["-c", "sh -c 'rm -rf x'"])).toContain("'rm'");
  });

  it("allows a read-only script", () => {
    expect(blocked("sh", ["-c", "git log | head -5; kubectl get pods"])).toBe(
      undefined,
    );
    expect(blocked("sh", ["-c", "echo 'git push'"])).toBe(undefined);
  });

  it("sees through wrappers", () => {
    expect(blocked("sudo", ["-u", "root", "rm", "x"])).toContain("'rm'");
    expect(blocked("env", ["A=1", "kubectl", "apply", "-f", "x"])).toContain(
      "'kubectl apply'",
    );
    expect(blocked("timeout", ["5", "helm", "uninstall", "r"])).toContain(
      "'helm uninstall'",
    );
    expect(blocked("eval", ["rm -rf x"])).toContain("'rm'");
    expect(blocked("env", ["git", "status"])).toBe(undefined);
  });

  it("blocks find -delete and a mutating find -exec", () => {
    expect(blocked("find", [".", "-name", "*.tmp", "-delete"])).toContain(
      "'find -delete'",
    );
    expect(blocked("find", [".", "-exec", "rm", "{}", ";"])).toContain("'rm'");
    expect(blocked("find", [".", "-exec", "grep", "x", "{}", ";"])).toBe(
      undefined,
    );
  });
});
