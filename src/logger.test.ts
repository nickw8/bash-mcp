/**
 * Tests for the wide-event logger.
 *
 * The logger writes one JSON event per tool call to stderr, gated by a level
 * resolved from BASH_MCP_LOG (default "error" = only error outcomes). Tests
 * inject a capturing write fn and explicit level — no real stderr, no env.
 */

import { describe, expect, it } from "vitest";
import { createLogger, logLifecycle, resolveLevel } from "./logger.js";

function capturing(level: "off" | "error" | "info") {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    context: { service: "bash-mcp", version: "9.9.9", pid: 123 },
    write: (s) => lines.push(s),
  });
  return { logger, lines };
}

describe("resolveLevel", () => {
  it("defaults to error when unset", () => {
    expect(resolveLevel(undefined)).toBe("error");
    expect(resolveLevel("")).toBe("error");
  });
  it("maps info / off / silent", () => {
    expect(resolveLevel("info")).toBe("info");
    expect(resolveLevel("off")).toBe("off");
    expect(resolveLevel("silent")).toBe("off");
  });
  it("unknown values fall back to error", () => {
    expect(resolveLevel("verbose")).toBe("error");
  });
});

describe("createLogger", () => {
  it("info level emits both success and error events", () => {
    const { logger, lines } = capturing("info");
    logger.logEvent({ tool: "a", outcome: "success", duration_ms: 1 });
    logger.logEvent({ tool: "b", outcome: "error", duration_ms: 2 });
    expect(lines).toHaveLength(2);
  });

  it("error level (default) emits only error outcomes", () => {
    const { logger, lines } = capturing("error");
    logger.logEvent({ tool: "a", outcome: "success", duration_ms: 1 });
    logger.logEvent({ tool: "b", outcome: "error", duration_ms: 2 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).tool).toBe("b");
  });

  it("off level emits nothing", () => {
    const { logger, lines } = capturing("off");
    logger.logEvent({ tool: "a", outcome: "error", duration_ms: 1 });
    expect(lines).toHaveLength(0);
  });

  it("emits valid JSON with static context merged in, newline-terminated", () => {
    const { logger, lines } = capturing("info");
    logger.logEvent({ tool: "a", outcome: "success", duration_ms: 5 });
    expect(lines[0]!.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toMatchObject({
      service: "bash-mcp",
      version: "9.9.9",
      pid: 123,
      tool: "a",
      outcome: "success",
      duration_ms: 5,
    });
  });
});

describe("logLifecycle", () => {
  it("emits a structured JSON event with static context, newline-terminated", () => {
    const lines: string[] = [];
    logLifecycle({ event: "server_start", transport: "stdio" }, (s) =>
      lines.push(s),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toMatchObject({
      service: "bash-mcp",
      event: "server_start",
      transport: "stdio",
    });
    expect(typeof parsed.version).toBe("string");
  });
});
