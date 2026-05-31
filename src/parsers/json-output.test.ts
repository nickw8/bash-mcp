import { describe, expect, it } from "vitest";
import { parseJsonishOutput } from "./json-output.js";

describe("parseJsonishOutput", () => {
  it("parses a single JSON object", () => {
    const r = parseJsonishOutput('{"a": 1, "b": "x"}');
    expect(r).toEqual({ kind: "single", value: { a: 1, b: "x" } });
  });

  it("parses a single JSON array as one value (not multi)", () => {
    const r = parseJsonishOutput("[1, 2, 3]");
    expect(r).toEqual({ kind: "single", value: [1, 2, 3] });
  });

  it("parses scalar values (number, string, bool, null)", () => {
    expect(parseJsonishOutput("42")).toEqual({ kind: "single", value: 42 });
    expect(parseJsonishOutput('"hi"')).toEqual({ kind: "single", value: "hi" });
    expect(parseJsonishOutput("true")).toEqual({ kind: "single", value: true });
    expect(parseJsonishOutput("null")).toEqual({ kind: "single", value: null });
  });

  it("parses multiple JSON values, one per line, as multi", () => {
    const r = parseJsonishOutput('{"a":1}\n{"a":2}\n{"a":3}');
    expect(r).toEqual({
      kind: "multi",
      values: [{ a: 1 }, { a: 2 }, { a: 3 }],
    });
  });

  it("parses newline-separated scalars as multi", () => {
    expect(parseJsonishOutput("1\n2\n3")).toEqual({
      kind: "multi",
      values: [1, 2, 3],
    });
  });

  it("falls back to raw when any line is not valid JSON", () => {
    const r = parseJsonishOutput('{"a":1}\nnot json here');
    expect(r).toEqual({ kind: "raw", text: '{"a":1}\nnot json here' });
  });

  it("treats plain text (jq -r / yaml output) as raw", () => {
    expect(parseJsonishOutput("hello world")).toEqual({
      kind: "raw",
      text: "hello world",
    });
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseJsonishOutput('  \n {"a":1} \n ')).toEqual({
      kind: "single",
      value: { a: 1 },
    });
  });

  it("returns raw empty text for empty / whitespace-only input", () => {
    expect(parseJsonishOutput("")).toEqual({ kind: "raw", text: "" });
    expect(parseJsonishOutput("   \n  ")).toEqual({ kind: "raw", text: "" });
  });
});
