import { describe, expect, it } from "vitest";
import { windowMatchText } from "./window.js";

describe("windowMatchText", () => {
  it("trims surrounding whitespace on a short line", () => {
    expect(windowMatchText("   const token = x;  ", 9, 14, 300)).toBe(
      "const token = x;",
    );
  });

  it("returns the trimmed line unchanged when within maxLen", () => {
    expect(windowMatchText("abc def", 0, 3, 300)).toBe("abc def");
  });

  it("returns the full trimmed line when maxLen is 0 (unlimited)", () => {
    const long = `${"x".repeat(50)}MATCH${"y".repeat(50)}`;
    expect(windowMatchText(long, 50, 55, 0)).toBe(long);
  });

  it("windows a long line around the match with ellipses on both edges", () => {
    const long = `${"a".repeat(100)}MATCH${"b".repeat(100)}`;
    const out = windowMatchText(long, 100, 105, 20);
    expect(out).toContain("MATCH");
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(20 + 2 + 2);
  });

  it("keeps the leading edge without a prefix ellipsis", () => {
    const long = `MATCH${"b".repeat(100)}`;
    const out = windowMatchText(long, 0, 5, 20);
    expect(out.startsWith("…")).toBe(false);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toContain("MATCH");
  });
});
