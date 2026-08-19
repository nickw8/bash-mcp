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
import type { ZodObject, ZodRawShape, ZodTypeAny } from "zod";
import type { Logger, WideEvent } from "./logger.js";
import { registerAll } from "./registry.js";
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
    // config is rebuilt (equivalentCommands folded into _meta, inputSchema
    // wrapped in a strict object), so compare the forwarded fields by value.
    const forwarded = captured[0]!.config as Record<string, unknown>;
    expect(forwarded).toMatchObject({
      title: "T",
      description: "d",
      annotations: { readOnlyHint: true },
      _meta: { foo: "bar" },
    });
    // An undeclared argument is refused rather than silently dropped.
    const schema = forwarded.inputSchema as ZodObject<ZodRawShape>;
    expect(schema.safeParse({ nope: 1 }).success).toBe(false);
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

  describe("required args", () => {
    const define = (required: string[], calls: unknown[] = []) => {
      const { server, captured } = fakeServer();
      const { logger, events } = capturingLogger();
      defineTool(
        server,
        "t",
        { inputSchema: {}, required },
        async (args: unknown) => {
          calls.push(args);
          return ok({ x: 1 });
        },
        logger,
      );
      return {
        handler: captured[0]!.handler,
        config: captured[0]!.config,
        events,
      };
    };

    it("fails with invalid_input and never calls the handler", async () => {
      const calls: unknown[] = [];
      const { handler, events } = define(["pattern"], calls);
      const res = await handler({}, {});
      expect(res.isError).toBe(true);
      expect(res.structuredContent.error).toMatchObject({
        kind: "invalid_input",
        command: "t",
      });
      expect(res.content[0].text).toContain(
        "missing required argument pattern",
      );
      expect(res.structuredContent.error.suggestion).toContain(
        "pattern: <value>",
      );
      expect(calls).toEqual([]);
      expect(events[0]).toMatchObject({
        outcome: "error",
        errorKind: "invalid_input",
      });
    });

    it("names every missing argument, not just the first", async () => {
      const { handler } = define(["resource", "namespace"]);
      const res = await handler({}, {});
      expect(res.content[0].text).toContain(
        "missing required arguments resource, namespace",
      );
    });

    it("accepts falsy-but-present values and runs the handler", async () => {
      const calls: unknown[] = [];
      const { handler } = define(["pattern"], calls);
      const res = await handler({ pattern: "" }, {});
      expect(res.isError).toBeUndefined();
      expect(calls).toHaveLength(1);
    });

    it("keeps required out of the config the SDK sees", () => {
      const { config } = define(["pattern"]);
      expect("required" in (config as object)).toBe(false);
    });
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

/**
 * The arg contract as the real tools declare it, not as a fake tool declares it.
 * `buildRegistry`'s stub throws the handlers away, so this registers every group
 * against a server that keeps them.
 */
function realTools() {
  const handlers = new Map<string, Handler>();
  const configs = new Map<
    string,
    { inputSchema?: ZodObject<Record<string, ZodTypeAny>> }
  >();
  const server = {
    registerTool(name: string, config: unknown, handler: Handler) {
      handlers.set(name, handler);
      configs.set(
        name,
        config as { inputSchema?: ZodObject<Record<string, ZodTypeAny>> },
      );
      return undefined;
    },
  } as unknown as McpServer;
  resetRegistry();
  registerAll(server);
  return { handlers, configs };
}

describe("the registered tools' arg contract", () => {
  const { handlers, configs } = realTools();

  it.each([
    ["rg", "pattern"],
    ["dotnet_build", "cwd"],
    ["npm_lint", "cwd"],
  ])("%s without %s answers invalid_input, not a protocol error", async (tool, arg) => {
    const res = await handlers.get(tool)?.({}, {});
    expect(res.isError).toBe(true);
    expect(res.structuredContent.error).toMatchObject({
      kind: "invalid_input",
      command: tool,
    });
    expect(res.content[0].text).toContain(`missing required argument ${arg}`);
    expect(res.structuredContent.error.suggestion).toContain(`${arg}: <value>`);
  });

  it("find_files without path searches '.' instead of failing", () => {
    const path = configs.get("find_files")?.inputSchema?.shape.path;
    expect(path?.parse(undefined)).toBe(".");
    const required = getRegisteredTools().find(
      (t) => t.name === "find_files",
    )?.required;
    expect(required ?? []).not.toContain("path");
  });

  it("bash_syntax_check treats files: 'x.sh' as files: ['x.sh']", async () => {
    const check = handlers.get("bash_syntax_check");
    const one = await check?.({ files: "hooks/bash-mcp-redirect.sh" }, {});
    const many = await check?.({ files: ["hooks/bash-mcp-redirect.sh"] }, {});
    expect(one.structuredContent).toEqual(many.structuredContent);
    expect(one.structuredContent).toMatchObject({ valid: true, errorCount: 0 });
  });

  // An empty list is not an answer. bash_syntax_check checked nothing and
  // reported valid:true for `files: []` until missingArgs learned to count it
  // as absent — a clean verdict on zero input is worse than an error, because
  // the caller acts on it.
  it.each([
    ["bash_syntax_check", "files"],
    ["bash_lint", "files"],
    ["batch", "commands"],
    ["run_seq", "steps"],
  ])("%s with an empty %s answers invalid_input", async (tool, arg) => {
    const res = await handlers.get(tool)?.({ [arg]: [] }, {});
    expect(res.isError).toBe(true);
    expect(res.structuredContent.error).toMatchObject({
      kind: "invalid_input",
      command: tool,
    });
    expect(res.content[0].text).toContain(`missing required argument ${arg}`);
  });
});
