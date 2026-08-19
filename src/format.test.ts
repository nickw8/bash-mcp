import { describe, expect, it } from "vitest";
import { formatList, projectRows, summarize } from "./format.js";

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

  it("JSON-encodes object/array meta values instead of [object Object]", () => {
    expect(formatList(ROWS, "tsv", { byType: { a: 1, b: 2 } })).toBe(
      'byType\t{"a":1,"b":2}\n---\nname\tsize\na\t1\nb\t2',
    );
  });

  it("omits low-signal meta (false/null/undefined/empty) and the --- if none remain", () => {
    // truncated:false is dropped; count:2 (number) is kept
    expect(formatList(ROWS, "tsv", { truncated: false, count: 2 })).toBe(
      "count\t2\n---\nname\tsize\na\t1\nb\t2",
    );
    // all meta dropped → no meta block, no separator
    expect(formatList(ROWS, "tsv", { truncated: false, note: "" })).toBe(
      "name\tsize\na\t1\nb\t2",
    );
    // zero is meaningful and retained
    expect(formatList([], "tsv", { count: 0 })).toBe("count\t0\n---");
  });

  it("uses the union of keys across ragged rows", () => {
    const ragged = [{ a: 1 }, { a: 2, b: 3 }];
    expect(formatList(ragged, "tsv")).toBe("a\tb\n1\t\n2\t3");
  });
});

describe("formatList — grouped", () => {
  const MATCHES = [
    { file: "a.ts", line: 1, text: "x" },
    { file: "a.ts", line: 9, text: "y" },
    { file: "b.ts", line: 4, text: "z" },
  ];

  it("groups consecutive rows by first column, header printed once", () => {
    expect(formatList(MATCHES, "grouped")).toBe(
      "a.ts:\n1\tx\n9\ty\nb.ts:\n4\tz",
    );
  });

  it("carries the meta block", () => {
    expect(formatList(MATCHES, "grouped", { matchCount: 3 })).toBe(
      "matchCount\t3\n---\na.ts:\n1\tx\n9\ty\nb.ts:\n4\tz",
    );
  });
});

describe("projectRows", () => {
  it("returns rows unchanged when fields is empty/undefined", () => {
    expect(projectRows(ROWS)).toBe(ROWS);
    expect(projectRows(ROWS, [])).toBe(ROWS);
  });

  it("keeps only the named fields, in order", () => {
    expect(projectRows([{ a: 1, b: 2, c: 3 }], ["c", "a"])).toEqual([
      { c: 3, a: 1 },
    ]);
  });

  it("skips fields absent from a row", () => {
    expect(projectRows([{ a: 1 }], ["a", "missing"])).toEqual([{ a: 1 }]);
  });
});

describe("formatList — bare", () => {
  it("emits tab-separated rows with NO header", () => {
    expect(formatList(ROWS, "bare")).toBe("a\t1\nb\t2");
  });

  it("collapses a single-column list to bare values (matches raw)", () => {
    expect(formatList([{ path: "x" }, { path: "y" }], "bare")).toBe("x\ny");
  });

  it("keeps the meta block and --- separator", () => {
    expect(formatList(ROWS, "bare", { count: 2 })).toBe(
      "count\t2\n---\na\t1\nb\t2",
    );
  });

  it("returns an empty string for no rows and no meta", () => {
    expect(formatList([], "bare")).toBe("");
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

describe("summarize", () => {
  it("inlines scalars", () => {
    expect(summarize({ path: "src/a.ts", count: 3, ok: true })).toBe(
      "path=src/a.ts count=3 ok=true",
    );
  });

  it("reports arrays as counts and nested objects as key counts", () => {
    expect(
      summarize({ files: ["a", "b", "c"], byType: { ts: 2, js: 1 } }),
    ).toBe("files[3] byType{2}");
  });

  it("reports a long string as a byte size, never its content", () => {
    const content = "x".repeat(500);
    const text = summarize({ path: "big.txt", content });
    expect(text).toBe("path=big.txt content=500B");
    expect(text).not.toContain("xxxx");
  });

  it("reports a short multi-line string as a size — newlines mean content", () => {
    expect(summarize({ content: "a\nb\n" })).toBe("content=4B");
  });

  it("measures bytes, not characters", () => {
    expect(summarize({ content: "é".repeat(100) })).toBe("content=200B");
  });

  it("drops low-signal values, matching the metadata prefix rules", () => {
    expect(
      summarize({
        found: 2,
        truncated: false,
        error: null,
        note: "",
        missing: undefined,
      }),
    ).toBe("found=2");
  });

  it("returns an empty string for an empty payload", () => {
    expect(summarize({})).toBe("");
  });

  it("caps a wide payload so one line cannot grow unbounded", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`field${i}`, i]),
    );
    const text = summarize(wide);
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text.endsWith("…")).toBe(true);
  });

  it("stays shorter than the serialized payload it describes", () => {
    const payload = {
      path: "src/response.ts",
      totalLines: 141,
      size: 4533,
      content: "y".repeat(4533),
      range: [1, 141],
      truncated: false,
    };
    expect(summarize(payload).length).toBeLessThan(
      JSON.stringify(payload).length,
    );
  });
});
