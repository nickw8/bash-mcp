#!/usr/bin/env node
/**
 * Opt-in live-agent evaluation. Not part of PR CI.
 *
 * The task eval (scripts/task-eval.mjs) replays fixtures deterministically.
 * This runs a real agent — the `claude` CLI in print mode — over a real
 * checkout twice per question: once with Bash only, once with bash-mcp only.
 * It then reports what each arm cost, as the CLI's own usage figures show.
 * bash-mcp contains no model; the agent is the external CLI, billed to
 * whoever runs this.
 *
 *   npm run build
 *   LIVE_EVAL=1 node scripts/live-eval.mjs --cwd ~/some/repo [--prompt "..."]
 *
 * Needs `claude` on PATH and authenticated. Agent runs are non-deterministic:
 * repeat a run and compare medians before quoting a number.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    cwd: { type: "string", default: process.cwd() },
    prompt: { type: "string", multiple: true },
    "max-turns": { type: "string", default: "12" },
  },
});

if (process.env.LIVE_EVAL !== "1") {
  console.error("live-eval runs a billed agent; set LIVE_EVAL=1 to confirm.");
  process.exit(2);
}

// Questions that hold for any git checkout, so no fixture system is needed.
const prompts = values.prompt ?? [
  "What is on this branch compared with main? Summarize the changed files and commits.",
  "Where is the entry point of this project, and what are its top-level modules?",
];

const server = resolve(import.meta.dirname, "../dist/index.js");
const dir = mkdtempSync(join(tmpdir(), "bash-mcp-live-"));
const mcpConfig = join(dir, "mcp.json");
writeFileSync(
  mcpConfig,
  JSON.stringify({
    mcpServers: { "bash-mcp": { command: "node", args: [server] } },
  }),
);

const ARMS = {
  bash: ["--strict-mcp-config", "--allowedTools", "Bash,Read"],
  "bash-mcp": [
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfig,
    "--allowedTools",
    "mcp__bash-mcp,Read",
    "--disallowedTools",
    "Bash",
  ],
};

function run(prompt, armArgs) {
  const out = execFileSync(
    "claude",
    [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--max-turns",
      values["max-turns"],
      ...armArgs,
    ],
    { cwd: values.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const r = JSON.parse(out);
  const u = r.usage ?? {};
  return {
    turns: r.num_turns,
    input:
      (u.input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0),
    output: u.output_tokens ?? 0,
    cost: r.total_cost_usd,
  };
}

console.log("arm\tturns\tinput\toutput\tcost_usd\tprompt");
for (const prompt of prompts) {
  for (const [arm, args] of Object.entries(ARMS)) {
    const r = run(prompt, args);
    console.log(
      [arm, r.turns, r.input, r.output, r.cost, prompt.slice(0, 40)].join("\t"),
    );
  }
}
