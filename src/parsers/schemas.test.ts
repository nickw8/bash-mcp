/**
 * Tests for the shared output-budget helper.
 *
 * applyBudget caps a row list per caller-supplied budget params so variable-size
 * tools (kube_get, kube_logs, lists) can shrink output on request. Omitting all
 * params must preserve the full list (current behavior).
 */

import { describe, expect, it } from "vitest";
import {
  applyBudget,
  budgetSchema,
  stringOrArray,
  toArray,
} from "./schemas.js";

const rows = Array.from({ length: 250 }, (_, i) => ({ i }));

describe("applyBudget", () => {
  it("no params → unchanged (full list, not truncated)", () => {
    const r = applyBudget(rows, {});
    expect(r.items).toHaveLength(250);
    expect(r.truncated).toBe(false);
    expect(r.total).toBe(250);
  });

  it("detailLevel summary caps to 20", () => {
    const r = applyBudget(rows, { detailLevel: "summary" });
    expect(r.items).toHaveLength(20);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(250);
  });

  it("detailLevel normal caps to 100", () => {
    const r = applyBudget(rows, { detailLevel: "normal" });
    expect(r.items).toHaveLength(100);
    expect(r.truncated).toBe(true);
  });

  it("detailLevel full does not cap", () => {
    const r = applyBudget(rows, { detailLevel: "full" });
    expect(r.items).toHaveLength(250);
    expect(r.truncated).toBe(false);
  });

  it("explicit maxItems overrides detailLevel default", () => {
    const r = applyBudget(rows, { detailLevel: "summary", maxItems: 5 });
    expect(r.items).toHaveLength(5);
    expect(r.truncated).toBe(true);
  });

  it("does not flag truncated when the list is within the cap", () => {
    const r = applyBudget([{ i: 1 }, { i: 2 }], { detailLevel: "summary" });
    expect(r.items).toHaveLength(2);
    expect(r.truncated).toBe(false);
  });

  it("exposes a Zod fragment with the budget params", () => {
    expect(Object.keys(budgetSchema).sort()).toEqual([
      "detailLevel",
      "includeRaw",
      "maxItems",
    ]);
  });
});

describe("toArray", () => {
  it("undefined → empty array", () => {
    expect(toArray(undefined)).toEqual([]);
  });

  it("single value → one-element array", () => {
    expect(toArray("src")).toEqual(["src"]);
  });

  it("array → returned as-is", () => {
    expect(toArray(["src", "test"])).toEqual(["src", "test"]);
  });

  it("empty array → empty array", () => {
    expect(toArray([])).toEqual([]);
  });
});

describe("stringOrArray", () => {
  const schema = stringOrArray("paths");

  it("accepts a single string", () => {
    expect(schema.parse("src")).toBe("src");
  });

  it("accepts an array of strings", () => {
    expect(schema.parse(["src", "test"])).toEqual(["src", "test"]);
  });

  it("accepts undefined (optional)", () => {
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it("rejects a non-string element", () => {
    expect(() => schema.parse([1])).toThrow();
  });
});
