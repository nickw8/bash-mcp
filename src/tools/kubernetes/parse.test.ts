/**
 * Fixture-driven tests for the pure Kubernetes parsers.
 *
 * summarizeResource is exercised against real `kubectl get -o json` shape from
 * fixtures/kubectl/pods.json; the log/context parsers use inline samples. No
 * cluster, no network.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type KubeList,
  parseContexts,
  parseLogLines,
  summarizeResource,
} from "./parse.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/kubectl",
);
function fixture(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

describe("summarizeResource (fixtures/kubectl/pods.json)", () => {
  const list = JSON.parse(fixture("pods.json")) as KubeList;
  const items = list.items.map(summarizeResource);

  it("summarizes a running pod with restart count", () => {
    const web = items[0]!;
    expect(web.name).toBe("web-7d9f");
    expect(web.namespace).toBe("default");
    expect(web.status).toBe("Running");
    expect(web.extra.kind).toBe("Pod");
    expect(web.extra.restarts).toBe("3");
    expect(web.labels).toEqual({ app: "web" });
  });

  it("summarizes a pending pod", () => {
    const db = items[1]!;
    expect(db.name).toBe("db-0");
    expect(db.namespace).toBe("data");
    expect(db.status).toBe("Pending");
    expect(db.extra.restarts).toBeUndefined();
  });

  it("summarizes a deployment with replica ratio", () => {
    const api = items[2]!;
    expect(api.extra.replicas).toBe("2/3");
  });

  it("never throws on an empty resource", () => {
    expect(() => summarizeResource({})).not.toThrow();
    expect(summarizeResource({}).status).toBe("Unknown");
  });
});

describe("parseLogLines", () => {
  it("splits RFC3339 timestamp from the message", () => {
    const out = parseLogLines(
      "2024-01-01T00:00:00Z hello world\n2024-01-01T00:00:01Z second line",
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      timestamp: "2024-01-01T00:00:00Z",
      message: "hello world",
    });
  });

  it("treats non-timestamped lines as message-only", () => {
    const out = parseLogLines("no timestamp here");
    expect(out[0]).toEqual({ timestamp: "", message: "no timestamp here" });
  });

  it("drops blank lines and handles empty input", () => {
    expect(parseLogLines("")).toEqual([]);
    expect(parseLogLines("\n\n")).toEqual([]);
  });
});

describe("parseContexts", () => {
  it("parses get-contexts output and marks the current context", () => {
    const out = parseContexts(
      "*         prod   prod-cluster   admin   kube-system\n          dev    dev-cluster    admin   default",
    );
    expect(out.current).toBe("prod");
    expect(out.contexts).toHaveLength(2);
    expect(out.contexts[0]).toEqual({
      name: "prod",
      cluster: "prod-cluster",
      namespace: "kube-system",
      current: true,
    });
    expect(out.contexts[1]!.current).toBe(false);
  });
});
