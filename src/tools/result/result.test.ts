/**
 * The response budget and result_get, end to end through a real SDK server and
 * client. The client validates structuredContent against the advertised
 * outputSchema, so a trimmed payload or its `retained` block that drifted from
 * the schema fails here, not in a user's session.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ok } from "#response";
import { defineTool } from "#tool";
import { registerResultTools } from "./result.js";

const quiet = { logEvent() {} } as never;

async function connect() {
  const server = new McpServer({ name: "t", version: "0" });
  defineTool(
    server,
    "big_list",
    {
      inputSchema: {
        n: z.number(),
        detailLevel: z.enum(["summary", "normal", "full"]).optional(),
      },
      outputSchema: {
        rows: z.array(z.object({ name: z.string() })),
        count: z.number(),
      },
    },
    async ({ n }) => {
      const rows = Array.from({ length: n }, (_, i) => ({
        name: `row-${String(i).padStart(4, "0")}`,
      }));
      return ok({ rows, count: n });
    },
    quiet,
  );
  registerResultTools(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

type Payload = any;

afterEach(() => vi.unstubAllEnvs());

describe("response budget", () => {
  it("passes a small result through with no retained block", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "big_list",
      arguments: { n: 5 },
    });
    const sc = res.structuredContent as Payload;
    expect(sc.rows).toHaveLength(5);
    expect(sc.retained).toBeUndefined();
  });

  it("cuts a large result, says so in both blocks, and keeps the rest", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "big_list",
      arguments: { n: 2000 },
    });
    const sc = res.structuredContent as Payload;
    expect(JSON.stringify(sc).length).toBeLessThanOrEqual(16_500);
    expect(sc.count).toBe(2000);
    expect(sc.retained.mode).toBe("auto");
    expect(sc.retained.omitted).toEqual([
      { path: "rows", total: 2000, shown: sc.rows.length },
    ]);
    expect(sc.retained.id).toMatch(/^r_/);
    const text = (res.content as { text: string }[])[0]?.text ?? "";
    expect(text).toContain(`rows ${sc.rows.length}/2000`);
    expect(text).toContain(sc.retained.id);

    const page = await client.callTool({
      name: "result_get",
      arguments: { id: sc.retained.id, path: "rows", offset: 1990, limit: 50 },
    });
    const got = page.structuredContent as Payload;
    expect(page.isError).toBeFalsy();
    expect(got.tool).toBe("big_list");
    expect(got.total).toBe(2000);
    expect(got.value.map((r: { name: string }) => r.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `row-${1990 + i}`),
    );
  });

  it("answers an unknown id with a typed not_found error", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "result_get",
      arguments: { id: "r_doesnotexist" },
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Payload).error.kind).toBe("not_found");
  });

  it("refuses a path the payload does not have", async () => {
    const client = await connect();
    const big = await client.callTool({
      name: "big_list",
      arguments: { n: 2000 },
    });
    const id = (big.structuredContent as Payload).retained.id;
    const res = await client.callTool({
      name: "result_get",
      arguments: { id, path: "nope" },
    });
    expect((res.structuredContent as Payload).error.kind).toBe("invalid_input");
  });

  it("does not cut under BASH_MCP_RESPONSE_MODE=full or detailLevel full", async () => {
    const client = await connect();
    const asked = await client.callTool({
      name: "big_list",
      arguments: { n: 2000, detailLevel: "full" },
    });
    expect((asked.structuredContent as Payload).rows).toHaveLength(2000);
    vi.stubEnv("BASH_MCP_RESPONSE_MODE", "full");
    const env = await client.callTool({
      name: "big_list",
      arguments: { n: 2000 },
    });
    expect((env.structuredContent as Payload).rows).toHaveLength(2000);
  });

  it("cuts harder under summary mode", async () => {
    vi.stubEnv("BASH_MCP_RESPONSE_MODE", "summary");
    const client = await connect();
    const res = await client.callTool({
      name: "big_list",
      arguments: { n: 2000 },
    });
    expect(JSON.stringify(res.structuredContent).length).toBeLessThanOrEqual(
      4_500,
    );
  });

  it("reports a cut it could not keep without offering an id", async () => {
    vi.stubEnv("BASH_MCP_RESULT_TTL", "0");
    vi.resetModules();
    const client = await connectFresh();
    const res = await client.callTool({
      name: "big_list",
      arguments: { n: 2000 },
    });
    const sc = res.structuredContent as Payload;
    expect(sc.retained.omitted).toHaveLength(1);
    expect(sc.retained.id).toBeUndefined();
    expect((res.content as { text: string }[])[0]?.text).toContain(
      "rest not kept",
    );
  });
});

/** connect() against freshly imported modules, so the store re-reads its env. */
async function connectFresh() {
  const { defineTool: freshDefine } = await import("#tool");
  const { registerResultTools: freshResult } = await import("./result.js");
  const { ok: freshOk } = await import("#response");
  const server = new McpServer({ name: "t", version: "0" });
  freshDefine(
    server,
    "big_list",
    {
      inputSchema: { n: z.number() },
      outputSchema: { rows: z.array(z.string()) },
    },
    async ({ n }) =>
      freshOk({
        rows: Array.from({ length: n }, (_, i) => `row ${i} `.repeat(4)),
      }),
    quiet,
  );
  freshResult(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
