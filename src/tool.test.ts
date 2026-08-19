/**
 * Tests for defineTool — the wide-event + uniform-error wrapper around
 * server.registerTool.
 *
 * Uses a minimal fake server that captures (name, config, handler), then
 * invokes the wrapped handler directly and asserts the response is preserved,
 * config (annotations/_meta) is forwarded, and exactly one wide event is
 * emitted with the right outcome.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import type { Logger, WideEvent } from "./logger.js";
import { err, ok } from "./response.js";
import { defineTool, getRegisteredTools, resetRegistry } from "./tool.js";

type Handler = (...args: unknown[]) => Promise<any>;
type Captured = { name: string; config: unknown; handler: Handler };

function fakeServer() {
  const captured: Captured[] = [];
  const server = {
    registerTool(name: string, config: unknown, handler: Handler) {
      captured.push({ name, config, handler });
      return undefined;
    },
  } as unknown as McpServer;
  return { server, captured };
}

function capturingLogger() {
  const events: WideEvent[] = [];
  const logger: Logger = { logEvent: (e) => events.push(e) };
  return { logger, events };
}

describe("defineTool", () => {
  it("forwards name and config (annotations/_meta) to registerTool", () => {
    const { server, captured } = fakeServer();
    const { logger } = capturingLogger();
    const config = {
      title: "T",
      description: "d",
      inputSchema: {},
      annotations: { readOnlyHint: true },
      _meta: { foo: "bar" },
    };
    defineTool(server, "t", config, async () => ok({ x: 1 }), logger);
    expect(captured[0]!.name).toBe("t");
    // config is rebuilt (equivalentCommands folded into _meta), so compare by value.
    expect(captured[0]!.config).toEqual(config);
  });

  it("folds equivalentCommands into _meta, preserving caller _meta", () => {
    const { server, captured } = fakeServer();
    const { logger } = capturingLogger();
    defineTool(
      server,
      "t",
      {
        inputSchema: {},
        _meta: { foo: "bar" },
        equivalentCommands: ["kubectl get pods -o json"],
      },
      async () => ok({}),
      logger,
    );
    const cfg = captured[0]!.config as Record<string, unknown>;
    expect(cfg._meta).toEqual({
      foo: "bar",
      equivalentCommands: ["kubectl get pods -o json"],
    });
    // equivalentCommands is not leaked as a top-level config field.
    expect(cfg.equivalentCommands).toBeUndefined();
  });

  it("omits _meta entirely when no caller _meta or equivalentCommands", () => {
    const { server, captured } = fakeServer();
    const { logger } = capturingLogger();
    defineTool(server, "t", { inputSchema: {} }, async () => ok({}), logger);
    expect("_meta" in (captured[0]!.config as object)).toBe(false);
  });

  it("captures a flattened registry record (incl. equivalentCommands)", () => {
    const { server } = fakeServer();
    const { logger } = capturingLogger();
    resetRegistry();
    defineTool(
      server,
      "t",
      {
        title: "T",
        description: "d",
        annotations: { readOnlyHint: true },
        inputSchema: {},
        equivalentCommands: ["git status"],
      },
      async () => ok({}),
      logger,
    );
    const record = getRegisteredTools().find((r) => r.name === "t");
    expect(record).toMatchObject({
      name: "t",
      title: "T",
      readOnlyHint: true,
      equivalentCommands: ["git status"],
    });
    resetRegistry();
  });

  it("names the tool when the payload summarizes to nothing", async () => {
    const { server, captured } = fakeServer();
    const { logger } = capturingLogger();
    // Every field low-signal → summarize() returns "", which would ship a blank
    // text block.
    defineTool(
      server,
      "t",
      { inputSchema: {} },
      async () => ok({ found: false, note: "" }),
      logger,
    );
    const res = await captured[0]!.handler({}, {});
    expect(res.content[0].text).toBe("t");
    expect(res.structuredContent).toEqual({ found: false, note: "" });
  });

  it("preserves a successful result and logs a success event once", async () => {
    const { server, captured } = fakeServer();
    const { logger, events } = capturingLogger();
    defineTool(
      server,
      "t",
      { inputSchema: {} },
      async () => ok({ x: 1 }),
      logger,
    );
    const res = await captured[0]!.handler({ a: 1, b: 2 }, {});
    expect(res.structuredContent).toEqual({ x: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tool: "t",
      outcome: "success",
      argCount: 2,
    });
    expect(typeof events[0]!.duration_ms).toBe("number");
  });

  it("derives error outcome from result.isError (not only throws)", async () => {
    const { server, captured } = fakeServer();
    const { logger, events } = capturingLogger();
    defineTool(
      server,
      "t",
      { inputSchema: {} },
      async () =>
        err("nope", { x: null }, { kind: "not_found", message: "nope" }),
      logger,
    );
    const res = await captured[0]!.handler({}, {});
    expect(res.isError).toBe(true);
    expect(events[0]).toMatchObject({
      outcome: "error",
      errorKind: "not_found",
    });
  });

  it("converts a thrown error into an err() response and logs error outcome", async () => {
    const { server, captured } = fakeServer();
    const { logger, events } = capturingLogger();
    defineTool(
      server,
      "t",
      { inputSchema: {} },
      async () => {
        throw new Error("kaboom");
      },
      logger,
    );
    const res = await captured[0]!.handler({}, {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("kaboom");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: "error" });
  });

  it("logs cwd but never raw arg values (redaction)", async () => {
    const { server, captured } = fakeServer();
    const { logger, events } = capturingLogger();
    defineTool(server, "run", { inputSchema: {} }, async () => ok({}), logger);
    await captured[0]!.handler(
      { command: "aws", args: ["--secret", "TOKEN"], cwd: "/tmp" },
      {},
    );
    const e = events[0]!;
    expect(e.cwd).toBe("/tmp");
    expect(JSON.stringify(e)).not.toContain("TOKEN");
    expect(JSON.stringify(e)).not.toContain("aws");
  });
});
