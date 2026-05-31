import { describe, expect, it } from "vitest";
import { formatList } from "./format.js";

const ROWS = [
  { name: "a", size: 1 },
  { name: "b", size: 2 },
];

describe("formatList — json (default)", () => {
  it("serializes bare rows when no meta is given", () => {
    expect(formatList(ROWS, "json")).toBe(JSON.stringify(ROWS));
  });

  it("merges meta alongside rows", () => {
    expect(formatList(ROWS, "json", { count: 2 })).toBe(
      JSON.stringify({ count: 2, rows: ROWS }),
    );
  });
});

describe("formatList — tsv", () => {
  it("emits a header row then tab-separated values", () => {
    expect(formatList(ROWS, "tsv")).toBe("name\tsize\na\t1\nb\t2");
  });

  it("prefixes meta as key\\tvalue lines with a --- separator", () => {
    expect(formatList(ROWS, "tsv", { count: 2 })).toBe(
      "count\t2\n---\nname\tsize\na\t1\nb\t2",
    );
  });

  it("returns an empty string for no rows and no meta", () => {
    expect(formatList([], "tsv")).toBe("");
  });

  it("emits only meta (no header) when rows are empty", () => {
    expect(formatList([], "tsv", { count: 0 })).toBe("count\t0\n---");
  });

  it("escapes tabs, newlines, and nullish cells", () => {
    const out = formatList([{ a: "x\ty", b: "line1\nline2", c: null }], "tsv");
    expect(out).toBe("a\tb\tc\nx y\tline1\\nline2\t");
  });
});

describe("formatList — columnar", () => {
  it("lists keys once in cols with positional data arrays", () => {
    expect(formatList(ROWS, "columnar")).toBe(
      JSON.stringify({
        cols: ["name", "size"],
        data: [
          ["a", 1],
          ["b", 2],
        ],
      }),
    );
  });

  it("merges meta into the columnar envelope", () => {
    expect(formatList(ROWS, "columnar", { count: 2 })).toBe(
      JSON.stringify({
        count: 2,
        cols: ["name", "size"],
        data: [
          ["a", 1],
          ["b", 2],
        ],
      }),
    );
  });

  it("returns meta only (or empty object) when rows are empty", () => {
    expect(formatList([], "columnar")).toBe("{}");
    expect(formatList([], "columnar", { count: 0 })).toBe(
      JSON.stringify({ count: 0 }),
    );
  });
});
