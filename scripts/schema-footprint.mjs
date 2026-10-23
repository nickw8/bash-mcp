#!/usr/bin/env node
/**
 * schema-footprint.mjs — what the tool list costs before the agent does anything.
 *
 * Spawns the built server (`dist/index.js`) over stdio exactly as a client does,
 * runs the `initialize` + `tools/list` handshake, and token-counts the result two
 * ways:
 *
 *   wire  — the whole `tools/list` result as serialized JSON, outputSchema included
 *   model — `{ name, description, input_schema }` per tool, the shape the Anthropic
 *           Messages API receives. Claude Code forwards that and drops outputSchema,
 *           so `model` is the per-turn context cost; `wire` is the handshake bytes.
 *
 * Plus the server `instructions` string, which clients inject once per session.
 *
 *   node scripts/schema-footprint.mjs              # human report
 *   node scripts/schema-footprint.mjs --json       # machine report (used by the gate)
 *   BASH_MCP_PROFILE=core node scripts/schema-footprint.mjs
 *
 * Tokenizer: js-tiktoken o200k_base, the same proxy token-benchmark.mjs uses.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getEncoding } from "js-tiktoken";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const enc = getEncoding("o200k_base");
const tok = (s) => enc.encode(s).length;

/** Handshake against the built server; resolves with `{ init, tools }`. */
export function listTools(env = {}) {
  const child = spawn(process.execPath, [join(repoRoot, "dist", "index.js")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, BASH_MCP_LOG: "off", ...env },
  });
  let buffer = "";
  let stderr = "";
  const waiting = new Map();
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
    }
  });
  const send = (msg) =>
    new Promise((resolve) => {
      waiting.set(msg.id, resolve);
      child.stdin.write(`${JSON.stringify(msg)}\n`);
    });
  return new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code) reject(new Error(`server exited ${code}: ${stderr}`));
    });
    (async () => {
      const init = await send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "schema-footprint", version: "0" },
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );
      const list = await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      child.kill();
      resolve({
        init: init.result,
        tools: list.result.tools,
        wire: list.result,
      });
    })().catch(reject);
  });
}

/** Token-count a `tools/list` answer. Pure; exported for the regression gate. */
export function footprint({ init, tools, wire }) {
  const perTool = tools.map((t) => ({
    name: t.name,
    model: tok(
      JSON.stringify({
        name: t.name,
        description: t.description ?? "",
        input_schema: t.inputSchema,
      }),
    ),
    description: tok(t.description ?? ""),
    input: tok(JSON.stringify(t.inputSchema)),
    output: tok(JSON.stringify(t.outputSchema ?? {})),
  }));
  const sum = (k) => perTool.reduce((a, r) => a + r[k], 0);
  return {
    tokenizer: "o200k_base",
    protocolVersion: init.protocolVersion,
    tools: tools.length,
    instructions: tok(init.instructions ?? ""),
    wire: tok(JSON.stringify(wire)),
    model: sum("model"),
    description: sum("description"),
    input: sum("input"),
    output: sum("output"),
    perTool,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = footprint(await listTools());
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const { perTool, ...totals } = report;
    console.log(totals);
    console.log("\nlargest model-facing definitions:");
    for (const r of [...perTool]
      .sort((a, b) => b.model - a.model)
      .slice(0, 15)) {
      console.log(`  ${r.name.padEnd(32)} ${String(r.model).padStart(5)}`);
    }
  }
}
