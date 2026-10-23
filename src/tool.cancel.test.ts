/**
 * A cancelled MCP request kills the command it started: the client's abort
 * becomes `notifications/cancelled`, the SDK aborts `extra.signal`, and
 * `defineTool` hands that signal to `#exec` through `callSignal`.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { exec } from "#exec";
import { ok } from "#response";
import { defineTool } from "#tool";

describe.skipIf(process.platform === "win32")("request cancellation", () => {
  it("kills the running command when the client aborts", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    let finished: Promise<{ cancelled?: boolean; ms: number }> | undefined;
    defineTool(
      server,
      "slow",
      { description: "sleeps", outputSchema: { done: z.boolean() } },
      async () => {
        const start = Date.now();
        finished = exec("sleep", ["30"]).then((r) => ({
          cancelled: r.cancelled,
          ms: Date.now() - start,
        }));
        await finished;
        return ok({ done: true });
      },
    );
    const client = new Client({ name: "c", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const controller = new AbortController();
    const call = client.callTool({ name: "slow", arguments: {} }, undefined, {
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 200));
    controller.abort();
    await expect(call).rejects.toThrow();

    const result = await finished;
    expect(result?.cancelled).toBe(true);
    expect(result?.ms).toBeLessThan(5_000);
  });
});
