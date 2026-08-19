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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/**
 * The pathological corpus, written as raw bytes at test time rather than
 * committed.
 *
 * Two of these cannot survive a round trip through git: `crlf` would be
 * rewritten by `core.autocrlf` or a `.gitattributes` rule on someone's machine,
 * and `invalid-utf8`/`lone-surrogate` are not text at all. Generating them here
 * pins the exact bytes on every checkout, which is the whole point of the case.
 */
const CORPUS: Record<string, Buffer> = {
  // \r\n endings — the classic "extra byte the framer didn't expect".
  crlf: Buffer.from("alpha\r\nbeta\r\ngamma\r\n".repeat(40), "utf8"),
  // Embedded NUL. Valid in a file, not in a C string; JSON escapes it.
  nul: Buffer.concat([
    Buffer.from("before", "utf8"),
    Buffer.from([0x00]),
    Buffer.from("after\n", "utf8"),
  ]),
  // 0xC3 0x28 is a truncated two-byte sequence: decoding yields U+FFFD.
  "invalid-utf8": Buffer.from([0x68, 0x69, 0xc3, 0x28, 0xff, 0xfe, 0x0a]),
  // CESU-8 encoding of U+D800 — a lone high surrogate with no pair.
  "lone-surrogate": Buffer.concat([
    Buffer.from("lead", "utf8"),
    Buffer.from([0xed, 0xa0, 0x80]),
    Buffer.from("tail\n", "utf8"),
  ]),
  // Astral-plane codepoints, which JSON.stringify emits as surrogate pairs.
  emoji: Buffer.from("👩‍💻 🇬🇧 🧑🏽‍🚀 ✅\n".repeat(30), "utf8"),
  // ~4 KB of quote-dense nested JSON-in-jsonnet: the shape of the reported
  // failure, where every quote becomes \" once the payload is re-serialized.
  "escaped-quotes": Buffer.from(
    `{\n  "apps": {\n${Array.from(
      { length: 24 },
      (_, i) =>
        `    "service-${i}": {\n      "kind": "service",\n      "enabled": true,\n` +
        `      "change_paths": ["service-${i}/", "shared/"],\n` +
        `      "build": { "app_dir": "service-${i}", "image_name": "img.service.${i}" }\n    }`,
    ).join(",\n")}\n  }\n}\n`,
    "utf8",
  ),
};

/**
 * The exact file and range from the reported failure
 * (`.claude/handoff/bash-mcp-parse-error-2026-08-19.md`). It lives in a private
 * sibling repo and is deliberately not vendored here — bash-mcp publishes to
 * npm, and that file is internal CI config. The `escaped-quotes` fixture above
 * reproduces its shape; this case replays the real bytes when they are present.
 */
const REPORTED_FILE = resolve(
  repoRoot,
  "..",
  "pfp",
  "cicd-pipeline",
  "src",
  "ci_tools",
  "data",
  "apps.jsonnet",
);

describe.skipIf(!existsSync(distPath))("stdio transport round-trip", () => {
  let corpusDir: string;

  beforeAll(() => {
    corpusDir = mkdtempSync(join(tmpdir(), "bash-mcp-transport-"));
    for (const [name, bytes] of Object.entries(CORPUS)) {
      writeFileSync(join(corpusDir, name), bytes);
    }
  });

  afterAll(() => {
    rmSync(corpusDir, { recursive: true, force: true });
  });

  it("returns parseable frames for a cat of a source file", async () => {
    const { frames, malformed } = await rpcSession([
      callTool("cat", { path: resolve(repoRoot, "src/response.ts") }),
    ]);

    expect(malformed).toEqual([]);
    expect(frames).toHaveLength(2);
    expect(frames[1]?.result?.structuredContent).toBeDefined();
  });

  it.each(
    Object.keys(CORPUS),
  )("returns parseable frames for the %s fixture", async (name) => {
    const { frames, malformed } = await rpcSession([
      callTool("cat", { path: join(corpusDir, name) }),
    ]);

    expect(malformed).toEqual([]);
    expect(frames[1]?.result?.structuredContent).toBeDefined();
  });

  /**
   * The other half of the reported failures: not a malformed frame, but a
   * well-formed call carrying arguments the tool never declared. Zod's default
   * strip mode dropped them and the tool answered a question nobody asked —
   * `find_files({ pattern, nameContains })` searched with no name filter at all.
   */
  it("refuses an argument the tool does not declare", async () => {
    const { frames, malformed } = await rpcSession([
      callTool("find_files", { path: corpusDir, nameContains: "plan" }),
    ]);

    expect(malformed).toEqual([]);
    expect(JSON.stringify(frames[1])).toContain("nameContains");
    expect(frames[1]?.result?.structuredContent).toBeUndefined();
  });

  it("accepts pattern as an alias for find_files name", async () => {
    const { frames } = await rpcSession([
      callTool("find_files", { path: corpusDir, pattern: "emoji" }),
    ]);

    expect(frames[1]?.result?.structuredContent).toMatchObject({ count: 1 });
  });

  it("reads the whole corpus in one session without desyncing the framer", async () => {
    const names = Object.keys(CORPUS);
    const { frames, malformed } = await rpcSession(
      names.map((name) => callTool("cat", { path: join(corpusDir, name) })),
    );

    expect(malformed).toEqual([]);
    expect(frames).toHaveLength(names.length + 1);
  });

  it.skipIf(!existsSync(REPORTED_FILE))(
    "returns parseable frames for the reported apps.jsonnet range",
    async () => {
      const { frames, malformed } = await rpcSession([
        callTool("cat", {
          path: REPORTED_FILE,
          startLine: 70,
          endLine: 195,
        }),
      ]);

      expect(malformed).toEqual([]);
      expect(frames[1]?.result?.structuredContent).toBeDefined();
    },
  );
});

if (!existsSync(distPath)) {
  console.warn(
    `transport.stdio.test: skipped — ${distPath} not built. Run \`npm run build\`.`,
  );
}
