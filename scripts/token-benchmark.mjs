#!/usr/bin/env node
/**
 * token-benchmark.mjs — token-savings benchmark + doc generator (NOT a test).
 *
 * Compares the token count of RAW CLI text against the STRUCTURED text bash-mcp
 * returns for the same operation, per tool, plus aggregates and a scaling probe.
 * The samples are on-disk fixtures (fixtures/benchmarks/) — the single source of
 * truth shared with the CI guard in src/benchmark.fixtures.test.ts. No live
 * cluster, repo, or cloud credentials required.
 *
 *   node scripts/token-benchmark.mjs            # print the report
 *   node scripts/token-benchmark.mjs --write    # also regenerate the doc tables
 *
 * Tokenizer: js-tiktoken `o200k_base` (GPT-4o/o200k), a PROXY for Claude's
 * tokenizer — absolute counts differ from Claude's, but the *relative reduction*
 * (the headline) is robust. For EXACT Claude counts set USE_CLAUDE_TOKENIZER=1
 * with a direct Anthropic key in ANTHROPIC_API_KEY (the count_tokens API; does
 * not work through Vertex/Bedrock):
 *
 *   USE_CLAUDE_TOKENIZER=1 ANTHROPIC_API_KEY=sk-... node scripts/token-benchmark.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getEncoding } from "js-tiktoken";
import {
  aggregates,
  computeRows,
  label,
  loadCases,
  renderAggregatesTable,
  renderResultsTable,
  renderScalingTable,
  replaceRegion,
  scalingRows,
} from "./benchmark-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "..", "fixtures", "benchmarks");
const docPath = join(here, "..", "docs", "token-benchmarks.md");

const enc = getEncoding("o200k_base");
const proxyCount = (s) => enc.encode(s).length;

// Optional: real Claude token counts via the Anthropic count_tokens API. The
// API wraps the text in a user message, so counts carry a small constant
// per-call overhead — the relative reduction stays the robust figure.
const USE_CLAUDE = process.env.USE_CLAUDE_TOKENIZER === "1";
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

async function claudeCount(text) {
  const res = await fetch(
    "https://api.anthropic.com/v1/messages/count_tokens",
    {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        messages: [{ role: "user", content: text || " " }],
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`count_tokens ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return json.input_tokens;
}

const count = USE_CLAUDE ? claudeCount : async (s) => proxyCount(s);

const cases = loadCases(fixturesRoot);
const rows = await computeRows(cases, count);
const agg = aggregates(rows);
const scaling = await scalingRows(count);

// --- console report -------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);
const pct = (n) => `${n.toFixed(0)}%`;

const banner = USE_CLAUDE
  ? `Claude count_tokens (${CLAUDE_MODEL}) — exact Claude counts.`
  : "o200k_base (GPT-4o) — proxy for Claude; relative reduction is the headline.";
console.log(`Tokenizer: ${banner}\n`);
console.log(
  `${pad("Command", 44)} ${padl("raw", 6)} ${padl("struct", 7)} ${padl("saved", 7)} ${padl("budget", 7)}`,
);
console.log("-".repeat(74));
for (const r of [...rows].sort((a, b) => b.reduction - a.reduction)) {
  const over = r.strT > r.budget ? " !!" : "";
  console.log(
    `${pad(label(r), 44)} ${padl(r.rawT, 6)} ${padl(r.strT, 7)} ${padl(pct(r.reduction), 7)} ${padl(r.budget, 7)}${over}`,
  );
}
console.log("-".repeat(74));
console.log(
  `${pad("TOTAL (token-weighted)", 44)} ${padl(agg.totalRaw, 6)} ${padl(agg.totalStr, 7)} ${padl(pct(agg.tokenWeighted), 7)}`,
);
console.log(
  `${pad("MEDIAN per-command reduction", 44)} ${padl(pct(agg.median), 23)}`,
);
console.log(
  `${pad("FREQUENCY-weighted reduction", 44)} ${padl(pct(agg.frequencyWeighted), 23)}`,
);

console.log(
  "\nScaling: homogeneous terraform state list (→ tf_state_list) at N rows",
);
console.log(
  `${pad("N rows", 44)} ${padl("raw", 6)} ${padl("struct", 7)} ${padl("saved", 7)}`,
);
console.log("-".repeat(74));
for (const { n, r, s, reduction } of scaling) {
  console.log(
    `${pad(String(n), 44)} ${padl(r, 6)} ${padl(s, 7)} ${padl(pct(reduction), 7)}`,
  );
}

// --- doc generation (--write) --------------------------------------------
if (process.argv.includes("--write")) {
  if (USE_CLAUDE) {
    throw new Error(
      "refusing to --write the doc with Claude counts; the committed tables use the o200k proxy. Re-run without USE_CLAUDE_TOKENIZER.",
    );
  }
  let md = readFileSync(docPath, "utf8");
  md = replaceRegion(md, "RESULTS", renderResultsTable(rows));
  md = replaceRegion(md, "AGGREGATES", renderAggregatesTable(rows));
  md = replaceRegion(md, "SCALING", renderScalingTable(scaling));
  writeFileSync(docPath, md);
  console.log(`\nwrote generated tables to ${docPath}`);
}
