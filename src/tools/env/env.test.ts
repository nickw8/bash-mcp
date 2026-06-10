/**
 * Tests for the env tool group (check_environment).
 *
 * The version parser is the real logic worth testing — it must extract a
 * version from the many shapes CLIs print. The probe table and registration
 * are smoke-tested. No real binaries are executed here.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { PROBES, parseVersion, registerEnvTools } from "./env.js";

describe("parseVersion", () => {
  it("extracts versions from common CLI output shapes", () => {
    expect(parseVersion("v20.11.1")).toBe("20.11.1"); // node
    expect(parseVersion("git version 2.39.5")).toBe("2.39.5");
    expect(parseVersion("jq-1.7.1")).toBe("1.7.1");
    expect(parseVersion("Terraform v1.7.0\non linux_amd64")).toBe("1.7.0");
    expect(parseVersion("OpenTofu v1.6.2")).toBe("1.6.2");
    expect(parseVersion("v3.14.0+gae123")).toBe("3.14.0"); // helm --short
    expect(
      parseVersion("yq (https://github.com/mikefarah/yq/) version v4.40.5"),
    ).toBe("4.40.5");
    expect(parseVersion("ripgrep 14.1.0")).toBe("14.1.0");
    expect(parseVersion("8.0.100")).toBe("8.0.100"); // dotnet
    expect(parseVersion("mypy 1.8.0 (compiled: yes)")).toBe("1.8.0");
  });

  it("returns undefined when there is no version-like token", () => {
    expect(parseVersion("command not found")).toBeUndefined();
    expect(parseVersion("")).toBeUndefined();
  });
});

describe("PROBES", () => {
  it("covers the documented toolchain", () => {
    const names = PROBES.map((p) => p.name);
    for (const expected of [
      "node",
      "git",
      "kubectl",
      "terraform",
      "tofu",
      "helm",
      "argocd",
      "jq",
      "yq",
      "rg",
      "dotnet",
      "liquibase",
      "ruff",
      "mypy",
      "pytest",
      "shellcheck",
      "bats",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("uses only client-only version args (no server/auth calls)", () => {
    for (const p of PROBES) {
      const joined = p.versionArgs.join(" ");
      expect(joined).not.toContain("get");
      expect(joined).not.toContain("login");
      // any kube/argocd version probe must be client-scoped
      if (p.binary === "kubectl" || p.binary === "argocd") {
        expect(joined).toContain("--client");
      }
    }
  });
});

describe("registerEnvTools", () => {
  it("registers without throwing", () => {
    const registered: string[] = [];
    const server = {
      registerTool(name: string) {
        registered.push(name);
        return undefined;
      },
    } as unknown as McpServer;
    expect(() => registerEnvTools(server)).not.toThrow();
    expect(registered).toContain("check_environment");
  });
});
