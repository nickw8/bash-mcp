/**
 * Diagnostic tools: the declaration matches the shape, and every command a
 * Triage suggests names a real tool.
 *
 * `diagnostic: true` is stripped by defineTool and read by the docs; nothing
 * else ties it to the Triage envelope, so the first block does. The second
 * drives every place a suggestion is produced — the pure classifiers and the
 * handlers' Unknown-triage paths — and checks each against the registry, so a
 * renamed tool or an argument that no longer exists fails here, not in an
 * agent's retry loop.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { triageSchema } from "#parsers";
import { buildRegistry } from "./registry.js";
import { captureHandlers } from "./test-support.js";
import { registerArgocdTools } from "./tools/argocd/argocd.js";
import { summarizeAppHealth } from "./tools/argocd/health.js";
import type { ArgoApp } from "./tools/argocd/payload.js";
import { registerHelmTools } from "./tools/helm/helm.js";
import type { HelmStatus } from "./tools/helm/payload.js";
import { type HelmHistoryEntry, triageRelease } from "./tools/helm/triage.js";
import {
  diagnoseDeployment,
  diagnosePod,
  type KubeEvent,
  summarizeEvents,
} from "./tools/kubernetes/diagnose.js";
import { registerKubeDiagnosticTools } from "./tools/kubernetes/diagnostics.js";
import type { KubeResource } from "./tools/kubernetes/parse.js";

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#exec")>();
  return { ...actual, execJson: vi.fn() };
});
const { execJson } = await import("#exec");
const execJsonMock = vi.mocked(execJson);

const registry = buildRegistry();
const byName = new Map(registry.map((t) => [t.name, t]));
const fixture = <T>(dir: string, name: string) =>
  JSON.parse(readFileSync(join("fixtures", dir, name), "utf8")) as T;

describe("diagnostic declaration", () => {
  const envelope = Object.keys(triageSchema);

  it("is set exactly when the output carries the Triage envelope", () => {
    for (const t of registry) {
      const shaped =
        !!t.outputSchema && envelope.every((k) => k in (t.outputSchema ?? {}));
      expect(t.diagnostic === true, t.name).toBe(shaped);
    }
  });

  it("marks at least one tool, so the check above is not vacuous", () => {
    expect(registry.some((t) => t.diagnostic)).toBe(true);
  });
});

// ── Suggestion sources ───────────────────────────────────────────────

const collected: { source: string; commands: string[] }[] = [];
const add = (source: string, commands: string[]) =>
  collected.push({ source, commands });

// Pure classifiers.
const crashing = fixture<KubeResource>("kubectl", "pod-crashloop.json");
add("diagnosePod", diagnosePod(crashing).suggestedNextCommands);
add(
  "summarizeEvents",
  summarizeEvents(
    fixture<{ items: KubeEvent[] }>("kubectl", "events.json").items,
    "qa",
  ).suggestedNextCommands,
);
add(
  "diagnoseDeployment",
  diagnoseDeployment(
    fixture<KubeResource>("kubectl", "deployment-degraded.json"),
  ).suggestedNextCommands,
);
add(
  "triageRelease",
  triageRelease(
    fixture<HelmStatus>("helm", "status.json"),
    fixture<HelmHistoryEntry[]>("helm", "history.json"),
  ).suggestedNextCommands,
);
add(
  "summarizeAppHealth",
  summarizeAppHealth(fixture<ArgoApp>("argocd", "app-degraded.json"))
    .suggestedNextCommands,
);

// Handlers: the probe fails (Unknown triage), and for the pod list it answers.
const handlers = new Map([
  ...captureHandlers(registerKubeDiagnosticTools),
  ...captureHandlers(registerHelmTools),
  ...captureHandlers(registerArgocdTools),
]);
const argsFor: Record<string, unknown> = {
  kube_diagnose_pod: { pod: "p", namespace: "qa" },
  kube_pod_failure_summary: { namespace: "qa" },
  kube_deployment_status: { name: "d", namespace: "qa" },
  kube_events_summary: { namespace: "qa" },
  helm_release_triage: { release: "r", namespace: "qa" },
  argo_app_health_summary: { name: "a" },
};
const failedProbe = {
  data: null,
  error: "boom",
  exitCode: 1,
  detail: { kind: "command_failed", message: "boom" },
};

describe("suggestedNextCommands", () => {
  beforeAll(async () => {
    for (const t of registry.filter((x) => x.diagnostic)) {
      const handler = handlers.get(t.name);
      if (!handler) throw new Error(`no handler captured for ${t.name}`);
      execJsonMock.mockResolvedValue(failedProbe as never);
      const res = await handler?.(argsFor[t.name]);
      add(
        `${t.name} (probe failed)`,
        res?.structuredContent.suggestedNextCommands ?? [],
      );
    }
    execJsonMock.mockResolvedValue({
      data: { items: [crashing] },
      error: null,
      exitCode: 0,
    } as never);
    const res = await handlers.get("kube_pod_failure_summary")?.({
      namespace: "qa",
    });
    add(
      "kube_pod_failure_summary (answered)",
      res?.structuredContent.suggestedNextCommands ?? [],
    );
  });

  it("collects from every declared Diagnostic tool's handler", () => {
    const fromHandlers = collected.filter((c) => c.source.includes("("));
    expect(fromHandlers.length).toBe(
      registry.filter((t) => t.diagnostic).length + 1,
    );
    expect(collected.every((c) => Array.isArray(c.commands))).toBe(true);
  });

  it("every suggestion names a registered tool", () => {
    const seen = collected.flatMap((c) =>
      c.commands.map((cmd) => ({ source: c.source, cmd })),
    );
    expect(seen.length).toBeGreaterThan(5);
    for (const { source, cmd } of seen) {
      const tool = cmd.split(/\s+/)[0] ?? "";
      expect(byName.has(tool), `${source}: "${cmd}"`).toBe(true);
    }
  });

  it("every key=value argument is declared in that tool's inputSchema", () => {
    for (const { source, commands } of collected) {
      for (const cmd of commands) {
        const [tool = "", ...rest] = cmd.split(/\s+/);
        const declared = Object.keys(byName.get(tool)?.inputSchema ?? {});
        for (const token of rest) {
          const key = token.split("=")[0] ?? "";
          expect(token.includes("="), `${source}: "${cmd}"`).toBe(true);
          expect(declared, `${source}: "${cmd}" key ${key}`).toContain(key);
        }
      }
    }
  });

  // A suggestion is an executable call: an agent that follows it should not
  // have to guess a pod, or silently fall back to the `default` namespace.
  it("binds every required argument, and the namespace scope", () => {
    for (const { source, commands } of collected) {
      for (const cmd of commands) {
        const [tool = "", ...rest] = cmd.split(/\s+/);
        const t = byName.get(tool);
        const given = new Set(rest.map((token) => token.split("=")[0]));
        const shape = t?.inputSchema ?? {};
        const required = Object.entries(shape)
          .filter(([, s]) => !(s as { isOptional(): boolean }).isOptional())
          .map(([k]) => k)
          .concat(t?.required ?? []);
        for (const key of required) {
          expect(given.has(key), `${source}: "${cmd}" needs ${key}`).toBe(true);
        }
        if ("namespace" in shape) {
          expect(
            given.has("namespace") || given.has("allNamespaces"),
            `${source}: "${cmd}" drops the namespace`,
          ).toBe(true);
        }
      }
    }
  });
});
