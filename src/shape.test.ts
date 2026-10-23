/**
 * Tests for Shaping. Text in, text out — no process, no I/O.
 */

import { describe, expect, it } from "vitest";
import { collapseRepeats, lineKey, markRepeat, shapeOutput } from "./shape.js";

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

describe("collapseRepeats", () => {
  const collapse = (lines: string[]) =>
    collapseRepeats(lines, lineKey, markRepeat);

  it("merges a consecutive run into its first line, counted", () => {
    expect(collapse(["a", "b", "b", "b", "c"])).toEqual(["a", "b [×3]", "c"]);
  });

  it("merges only adjacent repeats, so order survives", () => {
    expect(collapse(["x", "y", "x"])).toEqual(["x", "y", "x"]);
  });

  it("ignores a leading timestamp and keeps the first one", () => {
    expect(
      collapse([
        "2026-10-23T12:00:01.5Z boom",
        "2026-10-23T12:00:02.1Z boom",
        "[2026-10-23 12:00:03,000] boom",
      ]),
    ).toEqual(["2026-10-23T12:00:01.5Z boom [×3]"]);
  });

  it("never merges blank lines", () => {
    expect(collapse(["a", "", "", "b"])).toEqual(["a", "", "", "b"]);
  });
});

describe("shapeOutput collapse", () => {
  const spam = `${Array(40).fill("retry").join("\n")}\ndone\n`;

  it("merges repeats before the line cap and counts the original lines", () => {
    const r = shapeOutput(spam, { maxLines: 5 });
    expect(r.text).toBe("retry [×40]\ndone");
    expect(r.totalLines).toBe(41);
    expect(r.truncated).toBe(false);
  });

  it("collapse: false returns the output verbatim", () => {
    const r = shapeOutput(spam, { maxLines: 0, collapse: false });
    expect(r.text.split("\n")).toHaveLength(41);
  });
});
