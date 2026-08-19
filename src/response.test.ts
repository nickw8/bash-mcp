/**
 * Tests for the MCP response helpers — ok()'s summarized text block, err()'s
 * backward compatibility, and the optional structured ToolError envelope.
 */

import { describe, expect, it } from "vitest";
import type { ZodRawShape, ZodTypeAny } from "zod";
import type { ToolError } from "./error.js";
import { buildRegistry } from "./registry.js";
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

/**
 * The text block must stay cheaper than the payload it describes, for every
 * tool — not just the ones anyone thought to test. Registry-driven like
 * `zero.test.ts`, so a tool added later is covered without editing this file.
 *
 * The sample fills each declared field with something oversized (a 400-byte
 * string, a three-element array) so the assertion has something to fail on: a
 * summary that inlined a field would be longer than the payload, and would
 * carry LEAK.
 */
const LEAK = "Z".repeat(400);

function sampleOf(schema: ZodTypeAny): unknown {
  // zod's _def is untyped by design
  const def = (schema as any)._def;
  switch (def?.typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodEffects":
      return sampleOf(def.innerType ?? def.schema);
    case "ZodString":
      return LEAK;
    case "ZodNumber":
    case "ZodBigInt":
      return 42;
    case "ZodBoolean":
      return true;
    case "ZodArray":
      return [0, 1, 2].map(() => sampleOf(def.type));
    case "ZodRecord":
      return { a: sampleOf(def.valueType), b: sampleOf(def.valueType) };
    case "ZodObject":
      return sample(def.shape());
    case "ZodTuple":
      return (def.items as ZodTypeAny[]).map(sampleOf);
    case "ZodLiteral":
      return def.value;
    case "ZodEnum":
      return def.values[0];
    case "ZodUnion":
      return sampleOf((def.options as ZodTypeAny[])[0] as ZodTypeAny);
    default:
      return LEAK;
  }
}

function sample(shape: ZodRawShape): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape)) {
    out[key] = sampleOf(field as ZodTypeAny);
  }
  return out;
}

describe("ok() over every registered tool's payload", () => {
  it.each(
    buildRegistry().filter((t) => t.outputSchema),
  )("$name: the text block is shorter than the payload and leaks no long field", (tool) => {
    const payload = sample(tool.outputSchema ?? {});
    const json = JSON.stringify(payload);
    const text = ok(payload).content[0]?.text ?? "";
    // Below 200 B the summary's own key names can cost more than the payload;
    // the guarantee is about payloads worth summarizing.
    if (json.length > 200) expect(text.length).toBeLessThan(json.length);
    expect(text).not.toContain("ZZZZ");
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
