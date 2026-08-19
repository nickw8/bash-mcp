/**
 * Process-level behavior of the shipped bundle: what a client can see without
 * reading a single frame.
 *
 * Both cases are about stderr, and neither can be observed in-process — the
 * assertions are on a real exit code and on the bytes a spawned server writes
 * before anyone talks to it. Needs `npm run build`; skips with a message when
 * dist/ is absent, matching `transport.stdio.test.ts`.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distPath = join(repoRoot, "dist", "index.js");

interface Exit {
  code: number | null;
  stderr: string;
}

/**
 * Boot the bundle in a child and collect its stderr.
 *
 * `after` is module source appended to the import, so a test can force a crash
 * the way a runtime defect would — after the server is already connected.
 * Without it the child is killed once `waitMs` elapses, which is the clean-boot
 * case.
 */
function boot(after = "", waitMs = 400): Promise<Exit> {
  const source = `await import(${JSON.stringify(distPath)});\n${after}`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, BASH_MCP_LOG: undefined },
  });

  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += String(d);
  });

  return new Promise<Exit>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => child.kill(), waitMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      rejectPromise(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stderr });
    });
  });
}

describe.skipIf(!existsSync(distPath))("the server process", () => {
  it("reports an unhandled rejection as one event and exits non-zero", async () => {
    const { code, stderr } = await boot(
      "Promise.reject(new Error('forced-by-test'));",
    );

    expect(code).not.toBe(0);
    const lines = stderr.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      service: "bash-mcp",
      event: "unhandled_rejection",
      error: { message: "forced-by-test", type: "Error" },
    });
  });

  it("reports an uncaught exception the same way", async () => {
    const { code, stderr } = await boot(
      "setTimeout(() => { throw new Error('thrown-by-test'); }, 0);",
    );

    expect(code).not.toBe(0);
    expect(JSON.parse(stderr.trim())).toMatchObject({
      event: "uncaught_exception",
      error: { message: "thrown-by-test" },
    });
  });

  it("writes nothing to stderr on a clean boot", async () => {
    // A client that reads handshake-time stderr as a failed start must see an
    // empty channel; `server_start` moved behind BASH_MCP_LOG=info.
    expect((await boot()).stderr).toBe("");
  });
});

if (!existsSync(distPath)) {
  console.warn(
    `index.test: skipped — ${distPath} not built. Run \`npm run build\`.`,
  );
}
