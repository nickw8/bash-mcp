/**
 * Tests for Shaping. Text in, text out — no process, no I/O.
 */

import { describe, expect, it } from "vitest";
import { shapeOutput } from "./shape.js";

describe("shapeOutput", () => {
  const text = "l1\nl2\nl3\nl4\nl5\n";

  it("returns all lines (newline-normalized) when under the limit", () => {
    const r = shapeOutput(text, { maxLines: 10 });
    expect(r.text).toBe("l1\nl2\nl3\nl4\nl5");
    expect(r.totalLines).toBe(5);
    expect(r.truncated).toBe(false);
  });

  it("keeps the last N lines in tail mode with a marker", () => {
    const r = shapeOutput(text, { mode: "tail", maxLines: 2 });
    expect(r.text).toBe("... (3 lines truncated) ...\nl4\nl5");
    expect(r.totalLines).toBe(5);
    expect(r.truncated).toBe(true);
  });

  it("keeps the first N lines in head mode with a trailing marker", () => {
    const r = shapeOutput(text, { mode: "head", maxLines: 2 });
    expect(r.text).toBe("l1\nl2\n... (3 lines truncated) ...");
    expect(r.truncated).toBe(true);
  });

  it("treats maxLines 0/undefined as unlimited", () => {
    expect(shapeOutput(text, { maxLines: 0 }).truncated).toBe(false);
    expect(shapeOutput(text).truncated).toBe(false);
  });

  it("caps bytes, keeping the trimmed end per mode", () => {
    const tail = shapeOutput("abcdefgh", { maxBytes: 3 });
    expect(tail.text).toBe("fgh");
    expect(tail.truncated).toBe(true);
    const head = shapeOutput("abcdefgh", { mode: "head", maxBytes: 3 });
    expect(head.text).toBe("abc");
  });

  it("handles empty output", () => {
    const r = shapeOutput("");
    expect(r.text).toBe("");
    expect(r.totalLines).toBe(0);
    expect(r.truncated).toBe(false);
  });
});
