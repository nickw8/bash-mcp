import { describe, expect, it } from "vitest";
import {
  capText,
  fitToBudget,
  isUnhealthy,
  limitFor,
  responseModeFromEnv,
} from "./budget.js";

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `row-${i}`, size: i }));

describe("responseModeFromEnv", () => {
  it("defaults to auto and accepts every mode", () => {
    expect(responseModeFromEnv(undefined)).toBe("auto");
    expect(responseModeFromEnv("")).toBe("auto");
    for (const m of ["auto", "summary", "compact", "full"]) {
      expect(responseModeFromEnv(m)).toBe(m);
    }
  });

  it("refuses an unknown mode instead of guessing", () => {
    expect(() => responseModeFromEnv("tiny")).toThrow(/BASH_MCP_RESPONSE_MODE/);
  });
});

describe("limitFor", () => {
  it("doubles auto for an unhealthy result only", () => {
    expect(limitFor("auto", false)).toBe(16_000);
    expect(limitFor("auto", true)).toBe(32_000);
    expect(limitFor("compact", true)).toBe(12_000);
    expect(limitFor("full", false)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("isUnhealthy", () => {
  it("reads the verdict fields tools already use", () => {
    expect(isUnhealthy({}, true)).toBe(true);
    expect(isUnhealthy({ success: false }, false)).toBe(true);
    expect(isUnhealthy({ valid: false }, false)).toBe(true);
    expect(isUnhealthy({ healthy: false }, false)).toBe(true);
    expect(
      isUnhealthy({ status: "CrashLoopBackOff", likelyCauses: [] }, false),
    ).toBe(true);
    expect(isUnhealthy({ status: "Healthy", likelyCauses: [] }, false)).toBe(
      false,
    );
    // A plain `status` field on a non-diagnostic tool is not a verdict.
    expect(isUnhealthy({ status: "M src/a.ts" }, false)).toBe(false);
  });
});

describe("fitToBudget", () => {
  it("passes a payload under the limit through untouched", () => {
    const payload = { items: rows(3) };
    const fit = fitToBudget(payload, 10_000);
    expect(fit.payload).toBe(payload);
    expect(fit.omitted).toEqual([]);
  });

  it("cuts the largest array to an order-preserving prefix and reports it", () => {
    const payload = { items: rows(500), count: 500 };
    const fit = fitToBudget(payload, 2_000);
    expect(JSON.stringify(fit.payload).length).toBeLessThanOrEqual(2_000);
    const items = fit.payload.items as { name: string }[];
    expect(items[0]?.name).toBe("row-0");
    expect(items.map((r) => r.name)).toEqual(
      rows(items.length).map((r) => r.name),
    );
    expect(fit.omitted).toEqual([
      { path: "items", total: 500, shown: items.length },
    ]);
    // The input is not modified; the store keeps the original.
    expect(payload.items).toHaveLength(500);
  });

  it("is deterministic", () => {
    const payload = { a: rows(300), b: rows(50) };
    expect(fitToBudget(payload, 3_000)).toEqual(fitToBudget(payload, 3_000));
  });

  it("reaches nested arrays and names them by path", () => {
    const payload = {
      files: [
        {
          file: "a.ts",
          lines: Array.from({ length: 400 }, (_, i) => `${i}: x`),
        },
        { file: "b.ts", lines: ["1: y"] },
      ],
    };
    const fit = fitToBudget(payload, 1_000);
    expect(fit.omitted.map((o) => o.path)).toContain("files.0.lines");
    expect(JSON.stringify(fit.payload).length).toBeLessThanOrEqual(1_000);
  });

  it("never cuts inside a positional row", () => {
    const payload = {
      entries: [
        ["x".repeat(5_000), 1],
        ["y".repeat(5_000), 2],
      ],
    };
    const fit = fitToBudget(payload, 1_000);
    expect(fit.payload.entries).toEqual([["x".repeat(5_000), 1]]);
    expect(fit.omitted).toEqual([{ path: "entries", total: 2, shown: 1 }]);
  });

  it("keeps the newest items of a tail list and says so", () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i}`);
    const fit = fitToBudget({ lines }, 1_000, { tail: ["lines"] });
    const kept = fit.payload.lines as string[];
    expect(kept.at(-1)).toBe("line 399");
    expect(kept[0]).not.toBe("line 0");
    expect(fit.omitted).toEqual([
      { path: "lines", total: 400, shown: kept.length, from: "tail" },
    ]);
  });

  it("never cuts the triage answer fields", () => {
    const payload = {
      status: "CrashLoopBackOff",
      likelyCauses: Array.from({ length: 40 }, (_, i) =>
        `cause ${i} `.repeat(5),
      ),
      suggestedNextCommands: ["kubectl logs x"],
      evidence: Array.from({ length: 400 }, (_, i) => `event ${i}`),
    };
    const fit = fitToBudget(payload, 3_000);
    expect(fit.payload.likelyCauses).toHaveLength(40);
    expect(fit.omitted.map((o) => o.path)).toEqual(["evidence"]);
  });

  it("stops at one element per array when strings alone exceed the limit", () => {
    const payload = { items: ["x".repeat(5_000), "y".repeat(5_000)] };
    const fit = fitToBudget(payload, 1_000);
    expect(fit.payload.items).toHaveLength(1);
    expect(fit.size).toBeGreaterThan(1_000);
  });
});

describe("capText", () => {
  it("leaves short text alone and cuts long text at a line", () => {
    expect(capText("a\nb", 100)).toBe("a\nb");
    const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const cut = capText(long, 100);
    expect(cut.length).toBeLessThan(140);
    expect(cut).toMatch(/\[text cut at \d+ of 100 lines\]$/);
    expect(cut.startsWith("line 0\nline 1\n")).toBe(true);
  });
});
