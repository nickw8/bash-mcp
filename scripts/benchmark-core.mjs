/**
 * benchmark-core.mjs — pure helpers shared by the benchmark script (reporting +
 * doc generation) and the fixture test (CI guard). No tokenizer, no TS deps:
 * everything here is fs + string work so both a plain-node script and a vitest
 * run can import it.
 *
 * Source of truth is fixtures/benchmarks/: a manifest.json of
 * { id, command, weight, budget } plus per-tool raw.txt (CLI capture) and
 * expected.txt (the bash-mcp text block). The doc's results/aggregates/scaling
 * tables are rendered from these — never hand-edited — so they can't drift.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Read the manifest and inline each case's raw/expected fixture text. */
export function loadCases(root) {
  const manifest = JSON.parse(
    readFileSync(join(root, "manifest.json"), "utf8"),
  );
  return manifest.map((m) => ({
    ...m,
    raw: readFileSync(join(root, m.id, "raw.txt"), "utf8"),
    structured: readFileSync(join(root, m.id, "expected.txt"), "utf8"),
  }));
}

/** Token-count each case's raw/structured text with the given `count` fn. */
export async function computeRows(cases, count) {
  return Promise.all(
    cases.map(async (c) => {
      const [rawT, strT] = await Promise.all([
        count(c.raw),
        count(c.structured),
      ]);
      return {
        id: c.id,
        command: c.command,
        weight: c.weight,
        budget: c.budget,
        rawT,
        strT,
        reduction: ((rawT - strT) / rawT) * 100,
      };
    }),
  );
}

export function aggregates(rows) {
  const totalRaw = rows.reduce((s, r) => s + r.rawT, 0);
  const totalStr = rows.reduce((s, r) => s + r.strT, 0);
  const tokenWeighted = ((totalRaw - totalStr) / totalRaw) * 100;

  const sorted = rows.map((r) => r.reduction).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  const wRaw = rows.reduce((s, r) => s + r.rawT * r.weight, 0);
  const wStr = rows.reduce((s, r) => s + r.strT * r.weight, 0);
  const frequencyWeighted = ((wRaw - wStr) / wRaw) * 100;

  return { totalRaw, totalStr, tokenWeighted, median, frequencyWeighted };
}

const pct = (n) => `${n.toFixed(0)}%`;

// "git diff (→ git_diff)" → "git diff"; strips the trailing arrow annotation.
const baseCommand = (command) => command.replace(/\s*\(→.*\)\s*$/u, "").trim();

/** Display label for a case: `<cli command>` (→ `<tool id>`). */
export function label(c) {
  return `\`${baseCommand(c.command)}\` (→ \`${c.id}\`)`;
}

/** Markdown results table (rows sorted by saved %, with the weighted TOTAL). */
export function renderResultsTable(rows) {
  const sorted = [...rows].sort((a, b) => b.reduction - a.reduction);
  const lines = [
    "| Command | raw | struct | saved |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const r of sorted) {
    lines.push(`| ${label(r)} | ${r.rawT} | ${r.strT} | ${pct(r.reduction)} |`);
  }
  const a = aggregates(rows);
  lines.push(
    `| **TOTAL (token-weighted)** | ${a.totalRaw} | ${a.totalStr} | **${pct(a.tokenWeighted)}** |`,
  );
  return lines.join("\n");
}

/** Markdown aggregates table (the three headline reductions). */
export function renderAggregatesTable(rows) {
  const a = aggregates(rows);
  return [
    "| Aggregate | Reduction | What it measures |",
    "| --- | ---: | --- |",
    `| Token-weighted total | **${pct(a.tokenWeighted)}** | \`(Σraw − Σstruct)/Σraw\` — dominated by the few large samples (plan, describe, outline). |`,
    `| Median per-command reduction | **${pct(a.median)}** | Robust central tendency across the ${rows.length} commands; ignores sample size. |`,
    `| Frequency-weighted total | **${pct(a.frequencyWeighted)}** | Weighted by an illustrative session mix (read/diff/log/diagnose dominate, bulk infra listings are rare — see \`weight\` in the manifest). |`,
  ].join("\n");
}

// Synthetic, homogeneous terraform state list of N resources — used by the
// scaling section to show how the flat-list gap closes toward ~0% as rows grow
// (bare per-row cost equals the raw address; only the fixed meta is overhead).
export const SCALING_N = [5, 50, 200, 1000];

export const tfStateListRaw = (n) =>
  Array.from(
    { length: n },
    (_, i) => `module.network.aws_subnet.public[${i}]`,
  ).join("\n");

export const tfStateListStructured = (n) =>
  `count\t${n}\nbyType\t${JSON.stringify({ aws_subnet: n })}\n---\n${tfStateListRaw(n)}`;

export async function scalingRows(count) {
  return Promise.all(
    SCALING_N.map(async (n) => {
      const [r, s] = await Promise.all([
        count(tfStateListRaw(n)),
        count(tfStateListStructured(n)),
      ]);
      return { n, r, s, reduction: ((r - s) / r) * 100 };
    }),
  );
}

export function renderScalingTable(rows) {
  const lines = [
    "| N rows | raw | struct | saved |",
    "| ---: | ---: | ---: | ---: |",
  ];
  for (const { n, r, s, reduction } of rows) {
    lines.push(`| ${n} | ${r} | ${s} | ${pct(reduction)} |`);
  }
  return lines.join("\n");
}

/** Replace the body between <!-- BENCHMARK:NAME START/END --> markers. */
export function replaceRegion(md, name, content) {
  const start = `<!-- BENCHMARK:${name} START -->`;
  const end = `<!-- BENCHMARK:${name} END -->`;
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!re.test(md)) throw new Error(`benchmark doc region not found: ${name}`);
  return md.replace(re, `${start}\n${content}\n${end}`);
}

/** Extract the body between <!-- BENCHMARK:NAME START/END --> markers. */
export function extractRegion(md, name) {
  const start = `<!-- BENCHMARK:${name} START -->`;
  const end = `<!-- BENCHMARK:${name} END -->`;
  const m = md.match(new RegExp(`${start}\\n([\\s\\S]*?)\\n${end}`));
  if (!m) throw new Error(`benchmark doc region not found: ${name}`);
  return m[1];
}
