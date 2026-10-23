/**
 * Regression gate: the current build against the frozen v4.0.0 baseline.
 *
 * The baseline (`fixtures/benchmarks/baselines/v4.0.0.json`, hash-pinned by
 * benchmark.baseline.test.ts) holds the per-fixture token counts and the
 * tool-schema footprint as they were before v5. This test fails when a change
 * makes bash-mcp more expensive than that, beyond the slack below.
 *
 * Thresholds, and why:
 *   - per fixture: struct <= baseline * 1.10 + 5 tokens. Ten percent absorbs a
 *     new field that earns its place; the +5 keeps a two-token change on a
 *     tiny fixture from tripping a percentage.
 *   - token-weighted saving >= baseline - 1 point; median >= baseline - 2.
 *     The aggregates are what the README quotes.
 *   - model-facing schema (profile `all`) <= baseline * 1.05: room for about
 *     one new tool's definition, so a new tool is a decision and two are a
 *     conversation.
 * A fixture that has to grow goes in EXCEPTIONS with the reason, so the
 * growth is reviewed, not absorbed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getEncoding } from "js-tiktoken";
import { describe, expect, it } from "vitest";
import {
  aggregates,
  computeRows,
  fixturesRoot,
  loadCases,
} from "../scripts/benchmark-core.mjs";
import { footprint, listTools } from "../scripts/schema-footprint.mjs";

const baseline = JSON.parse(
  readFileSync(join(fixturesRoot, "baselines", "v4.0.0.json"), "utf8"),
);

/** Fixture id → why it may exceed the per-fixture threshold. */
const EXCEPTIONS: Record<string, string> = {};

const enc = getEncoding("o200k_base");
const rows = await computeRows(
  loadCases(fixturesRoot),
  async (s: string) => enc.encode(s).length,
);

describe("benchmark regression gate vs v4.0.0", () => {
  for (const row of rows) {
    const base = baseline.fixtures[row.id];
    if (!base || EXCEPTIONS[row.id]) continue;
    it(`${row.id} payload stays within baseline`, () => {
      expect(row.strT).toBeLessThanOrEqual(Math.floor(base.struct * 1.1) + 5);
    });
  }

  it("aggregate savings do not regress", () => {
    const now = aggregates(rows);
    expect(now.tokenWeighted).toBeGreaterThanOrEqual(
      baseline.aggregates.tokenWeighted - 1,
    );
    expect(now.median).toBeGreaterThanOrEqual(baseline.aggregates.median - 2);
  });

  it("every exception names a fixture that exists", () => {
    const ids = new Set(rows.map((r) => r.id));
    for (const id of Object.keys(EXCEPTIONS)) expect(ids.has(id)).toBe(true);
  });

  it("model-facing tool schema stays within 5% of baseline", async () => {
    const now = footprint(await listTools());
    expect(now.model).toBeLessThanOrEqual(
      Math.floor(baseline.schema.model * 1.05),
    );
  }, 30_000);
});
