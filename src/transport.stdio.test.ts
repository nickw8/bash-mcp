/**
 * Transport-level round-trip harness.
 *
 * Every other test calls a handler in-process, so it never sees the bytes the
 * client actually receives. This one spawns the *shipped* bundle the way an MCP
 * client does — `node dist/index.js` over stdio — speaks newline-delimited
 * JSON-RPC at it, and asserts each received frame re-parses. That is the only
 * place a framing or escaping defect could show up, and the one thing the
 * reported "tool call was malformed and could not be parsed" failures needed
 * ruling in or out.
 *
 * Needs `npm run build`; `pretest` runs it, and the suite skips with a message
 * when dist/ is absent so a bare `vitest` in a clean checkout still runs.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distPath = join(repoRoot, "dist", "index.js");

interface Frame {
  id?: number;
  result?: { content?: { text?: string }[]; structuredContent?: unknown };
  error?: unknown;
}

interface SessionResult {
  /** Frames that parsed, in arrival order. */
  frames: Frame[];
  /** Raw lines that did NOT parse — the failure evidence (AC-6). */
  malformed: string[];
  stderr: string;
}

/**
 * Drive one stdio session: initialize, then each request in order.
 *
 * Requests are written only after the handshake completes, so the server is
 * never asked to answer a tools/call it would reject on protocol grounds and
 * we don't mistake that for a framing defect.
 */
async function rpcSession(
  requests: Record<string, unknown>[],
  timeoutMs = 20_000,
): Promise<SessionResult> {
  const child = spawn(process.execPath, [distPath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, BASH_MCP_LOG: "off" },
  });

  const frames: Frame[] = [];
  const malformed: string[] = [];
  let stderr = "";
  let buffer = "";
  const lastId = requests.length + 1;

  return await new Promise<SessionResult>((resolvePromise, rejectPromise) => {
    const done = () => {
      clearTimeout(timer);
      child.kill();
      resolvePromise({ frames, malformed, stderr });
    };
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(
        new Error(
          `stdio session timed out after ${timeoutMs}ms; frames=${frames.length} stderr=${stderr}`,
        ),
      );
    }, timeoutMs);

    const send = (msg: Record<string, unknown>) => {
      child.stdin.write(`${JSON.stringify(msg)}\n`);
    };

    child.stderr.on("data", (d) => {
      stderr += String(d);
    });

    child.on("error", (e) => {
      clearTimeout(timer);
      rejectPromise(e);
    });

    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      // Newline-delimited JSON: the last element is a partial frame until the
      // next chunk completes it.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim() === "") continue;
        let frame: Frame;
        try {
          frame = JSON.parse(line) as Frame;
        } catch {
          malformed.push(line);
          continue;
        }
        frames.push(frame);

        if (frame.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          requests.forEach((req, i) => {
            send({ ...req, id: i + 2 });
          });
        }
        if (frame.id === lastId) done();
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "transport-harness", version: "0" },
      },
    });
  });
}

const callTool = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  method: "tools/call",
  params: { name, arguments: args },
});

describe.skipIf(!existsSync(distPath))("stdio transport round-trip", () => {
  it("returns parseable frames for a cat of a source file", async () => {
    const { frames, malformed } = await rpcSession([
      callTool("cat", { path: resolve(repoRoot, "src/response.ts") }),
    ]);

    expect(malformed).toEqual([]);
    expect(frames).toHaveLength(2);
    expect(frames[1]?.result?.structuredContent).toBeDefined();
  });
});

if (!existsSync(distPath)) {
  console.warn(
    `transport.stdio.test: skipped — ${distPath} not built. Run \`npm run build\`.`,
  );
}
