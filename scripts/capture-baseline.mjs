#!/usr/bin/env node
/**
 * capture-baseline.mjs — freeze the current benchmark numbers as a named baseline.
 *
 * Writes fixtures/benchmarks/baselines/<name>.json holding the per-tool fixture
 * counts, the three aggregates, and the tool-schema footprint of the built
 * server. Refuses to overwrite: a baseline is the fixed point later work is
 * measured against, and `src/benchmark.baseline.test.ts` pins its hash.
 *
 *   npm run build && node scripts/capture-baseline.mjs v4.0.0
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getEncoding } from "js-tiktoken";
import {
  aggregates,
  computeRows,
  fixturesRoot,
  loadCases,
} from "./benchmark-core.mjs";
import { footprint, listTools } from "./schema-footprint.mjs";

const name = process.argv[2];
if (!name) throw new Error("usage: capture-baseline.mjs <name>");
const dir = join(fixturesRoot, "baselines");
const out = join(dir, `${name}.json`);
if (existsSync(out)) throw new Error(`${out} exists; baselines are immutable`);

const enc = getEncoding("o200k_base");
const rows = await computeRows(
  loadCases(fixturesRoot),
  async (s) => enc.encode(s).length,
);
const { perTool, ...schema } = footprint(await listTools());

const baseline = {
  name,
  commit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
  capturedAt: new Date().toISOString().slice(0, 10),
  tokenizer: "o200k_base",
  fixtures: Object.fromEntries(
    rows.map((r) => [r.id, { raw: r.rawT, struct: r.strT }]),
  ),
  aggregates: aggregates(rows),
  schema: {
    ...schema,
    perTool: Object.fromEntries(perTool.map((t) => [t.name, t.model])),
  },
};
mkdirSync(dir, { recursive: true });
writeFileSync(out, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`wrote ${out}`);
