/**
 * Tests for the guidance tool group (list_guidance).
 *
 * The const table and its filtering are the logic worth testing. Registration
 * is smoke-tested. No real binaries are executed here.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { buildRegistry } from "../../registry.js";
import { INTENTS, registerGuidanceTools } from "./guidance.js";

/** Every registered tool name — the registry answers "is this a real tool" exactly. */
const KNOWN_TOOLS = new Set(buildRegistry().map((t) => t.name));

describe("INTENTS", () => {
  it("is non-empty and well-formed", () => {
    expect(INTENTS.length).toBeGreaterThan(0);
    for (const entry of INTENTS) {
      expect(entry.intent).toBeTruthy();
      expect(entry.preferredTool).toBeTruthy();
      expect(entry.category).toBeTruthy();
      expect(entry.reason).toBeTruthy();
      expect(Array.isArray(entry.avoid)).toBe(true);
    }
  });

  it("only recommends real bash-mcp tools", () => {
    const unknown = INTENTS.map((e) => e.preferredTool).filter(
      (name) => !KNOWN_TOOLS.has(name),
    );
    expect(unknown, "INTENTS names tools that are not registered").toEqual([]);
  });
});

describe("registerGuidanceTools", () => {
  it("registers list_guidance without throwing", () => {
    const registered: string[] = [];
    const server = {
      registerTool(name: string) {
        registered.push(name);
        return undefined;
      },
    } as unknown as McpServer;
    expect(() => registerGuidanceTools(server)).not.toThrow();
    expect(registered).toContain("list_guidance");
  });
});

/**
 * The filter logic lives inside the handler closure, so exercise it via the same
 * predicate the handler uses. Mirrors how env.test.ts asserts on PROBES directly.
 */
describe("list_guidance filtering", () => {
  const filter = (opts: { intent?: string; category?: string }) => {
    const needle = opts.intent?.toLowerCase();
    return INTENTS.filter((entry) => {
      if (opts.category && entry.category !== opts.category) return false;
      if (needle && !entry.intent.toLowerCase().includes(needle)) return false;
      return true;
    });
  };

  it("returns all intents with no filter", () => {
    expect(filter({})).toHaveLength(INTENTS.length);
  });

  it("narrows by category", () => {
    const kube = filter({ category: "kubernetes" });
    expect(kube.length).toBeGreaterThan(0);
    expect(kube.every((e) => e.category === "kubernetes")).toBe(true);
  });

  it("narrows by intent substring (case-insensitive)", () => {
    const branch = filter({ intent: "BRANCH" });
    expect(branch.length).toBeGreaterThan(0);
    expect(branch.every((e) => e.intent.toLowerCase().includes("branch"))).toBe(
      true,
    );
  });

  it("returns an empty list (not an error) when nothing matches", () => {
    expect(filter({ intent: "no-such-intent-xyz" })).toHaveLength(0);
  });
});
