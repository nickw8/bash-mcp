/**
 * Tests for the MCP response helpers — specifically err()'s backward
 * compatibility and the optional structured ToolError envelope.
 */

import { describe, expect, it } from "vitest";
import type { ToolError } from "./error.js";
import { err } from "./response.js";

describe("err", () => {
  it("2-arg form leaves structuredContent unchanged (backward compatible)", () => {
    const r = err("boom", { items: [], count: 0 });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toBe("boom");
    expect(r.structuredContent).toEqual({ items: [], count: 0 });
  });

  it("merges ok:false + error when a ToolError is provided", () => {
    const toolErr: ToolError = {
      kind: "missing_binary",
      message: "kubectl not found",
      command: "kubectl",
      suggestion: "Install kubectl or check it is on PATH.",
    };
    const r = err("kubectl not found", { items: [] }, toolErr);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      items: [],
      ok: false,
      error: toolErr,
    });
  });
});
