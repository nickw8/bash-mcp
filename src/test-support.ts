/**
 * Test-only helpers for reaching a tool handler without spawning a process.
 *
 * Handlers are closures inside `register<Group>Tools`, so the only way in is a
 * server that captures what was registered. Combine with `vi.mock("#exec")` in
 * the test file (the mock must be declared there — vitest hoists it per module
 * graph) and a handler becomes an ordinary async function under test.
 *
 * Not imported by any production module; tsup tree-shakes it out of the bundle.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** What a tool handler returns, as much of it as tests read. */
export interface CapturedResult {
  isError?: boolean;
  content?: { type: string; text: string }[];
  // biome-ignore lint/suspicious/noExplicitAny: payload shape differs per tool
  structuredContent: any;
}

export type CapturedHandler = (args: unknown) => Promise<CapturedResult>;

/**
 * Register a group against a capturing stub and return its handlers by name.
 *
 * @example
 *   const ls = captureHandlers(registerFilesystemTools).get("ls");
 *   const res = await ls({ path: "/repo" });
 */
export function captureHandlers(
  register: (server: McpServer) => void,
): Map<string, CapturedHandler> {
  const handlers = new Map<string, CapturedHandler>();
  const stub = {
    registerTool(name: string, _config: unknown, handler: CapturedHandler) {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  register(stub);
  return handlers;
}

/** Same, for a single-tool group — throws if the name was never registered. */
export function captureHandler(
  register: (server: McpServer) => void,
  name: string,
): CapturedHandler {
  const handler = captureHandlers(register).get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  return handler;
}

/** A successful ExecResult carrying `stdout`. */
export function execOk(stdout: string, stderr = "") {
  return { stdout, stderr, exitCode: 0, timedOut: false };
}

/** A failed ExecResult carrying `stderr`. */
export function execFail(stderr: string, exitCode = 1) {
  return { stdout: "", stderr, exitCode, timedOut: false };
}
