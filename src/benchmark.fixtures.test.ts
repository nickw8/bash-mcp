import { readFileSync } from "node:fs";
import { getEncoding } from "js-tiktoken";
import { describe, expect, it } from "vitest";
import {
  aggregates,
  computeRows,
  docPath,
  extractRegion,
  fixturesRoot,
  loadCases,
  renderAggregatesTable,
  renderResultsTable,
  renderScalingTable,
  scalingRows,
  // benchmark-core is plain JS shared with scripts/token-benchmark.mjs
} from "../scripts/benchmark-core.mjs";

/**
 * Fixture-backed benchmark standard (CI guard).
 *
 * fixtures/benchmarks/ is the single source of truth: a manifest of
 * { id, command, weight, budget } plus per-tool raw.txt / expected.txt. This
 * test pins three things so the benchmark can't silently rot:
 *
 *   1. Each tool's structured (expected) text stays under its recorded token
 *      budget — the per-tool "standard". A format regression that re-inflates a
 *      tool's output trips here (NOT a blanket "smaller than raw": several tools
 *      are legitimately negative on tiny inputs — see docs/token-benchmarks.md —
 *      so each carries its own ceiling instead).
 *   2. Every manifest id has both fixture files and they're non-empty.
 *   3. The doc's generated tables match what the fixtures render right now, so
 *      docs/token-benchmarks.md can never drift from the data. Regenerate with
 *      `node scripts/token-benchmark.mjs --write` if this fails intentionally.
 *
 * Counts use o200k_base (a GPT proxy for Claude), matching the committed doc and
 * the budgets; the relative reductions are tokenizer-independent.
 *
 * Note: src/format.budget.test.ts is complementary — it feeds synthetic rows
 * through formatList to guard the formatter *code path*, which static fixtures
 * can't. This file guards the per-tool standard and the doc.
 */
const enc = getEncoding("o200k_base");
const tok = (s: string) => enc.encode(s).length;

const cases = loadCases(fixturesRoot);

describe("benchmark fixtures", () => {
  it("has at least one case", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    describe(c.id, () => {
      it("has non-empty raw and expected fixtures", () => {
        expect(c.raw.length).toBeGreaterThan(0);
        expect(c.structured.length).toBeGreaterThan(0);
      });

      it(`expected text stays under its ${c.budget}-token budget`, () => {
        expect(tok(c.structured)).toBeLessThanOrEqual(c.budget);
      });
    });
  }
});

describe("benchmark doc generation", () => {
  it("RESULTS / AGGREGATES / SCALING tables match the fixtures", async () => {
    const rows = await computeRows(cases, (s: string) => tok(s));
    const scaling = await scalingRows((s: string) => tok(s));
    const doc = readFileSync(docPath, "utf8");

    expect(extractRegion(doc, "RESULTS")).toBe(renderResultsTable(rows));
    expect(extractRegion(doc, "AGGREGATES")).toBe(renderAggregatesTable(rows));
    expect(extractRegion(doc, "SCALING")).toBe(renderScalingTable(scaling));
  });

  it("reports a positive token-weighted reduction overall", async () => {
    const rows = await computeRows(cases, (s: string) => tok(s));
    expect(aggregates(rows).tokenWeighted).toBeGreaterThan(0);
  });
});
