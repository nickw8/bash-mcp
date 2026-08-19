/**
 * Tests for the MCP response helpers — ok()'s summarized text block, err()'s
 * backward compatibility, and the optional structured ToolError envelope.
 */

import { describe, expect, it } from "vitest";
import type { ToolError } from "./error.js";
import { err, ok } from "./response.js";

describe("ok", () => {
  it("summarizes the payload instead of serializing it", () => {
    const r = ok({ path: "a.ts", content: "z".repeat(400), lines: 12 });
    expect(r.content[0]?.text).toBe("path=a.ts content=400B lines=12");
    expect(r.content[0]?.text).not.toContain("zzzz");
  });

  it("keeps structuredContent exactly as passed", () => {
    const payload = { path: "a.ts", rows: [1, 2] };
    expect(ok(payload).structuredContent).toBe(payload);
  });

  it("uses a caller-supplied summary verbatim", () => {
    expect(ok({ errorCount: 3 }, "3 errors in 2 files").content[0]?.text).toBe(
      "3 errors in 2 files",
    );
  });
});

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
