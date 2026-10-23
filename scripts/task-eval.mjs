#!/usr/bin/env node
/**
 * task-eval.mjs — deterministic task-level evaluation over the fixture corpus.
 *
 * The fixture benchmark prices one command at a time. This prices a task: the
 * raw commands an agent runs to answer a question, against the bash-mcp calls
 * that answer the same question. Each scenario in fixtures/tasks/scenarios.json
 * also lists `evidence`, the facts the answer depends on. Every one must be in
 * the raw output (the scenario is answerable) and in the bash-mcp payloads
 * (shorter output kept the answer). A scenario that saves tokens by dropping
 * evidence fails. That is the line between more efficient and merely shorter.
 *
 * Fixture-level: payloads are the corpus `expected.txt` contracts, priced as
 * the structuredContent the agent reads (ADR-0009). Not a live agent run; see
 * scripts/live-eval.mjs for that.
 *
 *   node scripts/task-eval.mjs            # table
 *   node scripts/task-eval.mjs --json     # machine report
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getEncoding } from "js-tiktoken";
import { fixturesRoot } from "./benchmark-core.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const enc = getEncoding("o200k_base");
const tok = (s) => enc.encode(s).length;
const read = (id, file) => readFileSync(join(fixturesRoot, id, file), "utf8");
/** Column-aligned CLI output pads with spaces; compare with runs collapsed. */
const squash = (s) => s.replace(/\s+/g, " ");

/** Every string value in a payload, so evidence is matched unescaped. */
function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number") out.push(String(value));
  else if (value && typeof value === "object") {
    for (const v of Object.values(value)) strings(v, out);
  }
  return out;
}

export function evaluate(
  scenarios = JSON.parse(
    readFileSync(join(repoRoot, "fixtures", "tasks", "scenarios.json"), "utf8"),
  ),
) {
  return scenarios.map((s) => {
    const raw = s.raw.map((id) => read(id, "raw.txt")).join("\n");
    const payloads = s.tools.map((id) => read(id, "expected.txt").trim());
    const text = squash(
      payloads.flatMap((p) => strings(JSON.parse(p))).join("\n"),
    );
    const rawText = squash(raw);
    const rawT = tok(raw);
    const mcpT = payloads.reduce((n, p) => n + tok(p), 0);
    return {
      id: s.id,
      rawCalls: s.raw.length,
      mcpCalls: s.tools.length,
      rawT,
      mcpT,
      saved: rawT === 0 ? 0 : (1 - mcpT / rawT) * 100,
      missingInRaw: s.evidence.filter((e) => !rawText.includes(e)),
      missingInMcp: s.evidence.filter((e) => !text.includes(e)),
    };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = evaluate();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(
      "scenario                 calls raw/mcp   raw   mcp  saved  evidence",
    );
    for (const r of rows) {
      const ev =
        r.missingInMcp.length || r.missingInRaw.length
          ? `MISSING mcp=[${r.missingInMcp}] raw=[${r.missingInRaw}]`
          : "ok";
      console.log(
        `${r.id.padEnd(24)} ${`${r.rawCalls}/${r.mcpCalls}`.padStart(11)} ${String(r.rawT).padStart(5)} ${String(r.mcpT).padStart(5)} ${r.saved.toFixed(0).padStart(5)}%  ${ev}`,
      );
    }
  }
}
