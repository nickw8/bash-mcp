/**
 * Tests for the mypy diagnostic parser.
 */

import { describe, expect, it } from "vitest";
import { parseMypyOutput } from "./mypy.js";

describe("parseMypyOutput", () => {
  it("parses mypy error lines with column numbers", () => {
    const input = `src/app.py:10:5: error: Incompatible types in assignment  [assignment]
src/util.py:3:1: error: Cannot find name 'foo'  [name-defined]`;

    const result = parseMypyOutput(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      file: "src/app.py",
      line: 10,
      column: 5,
      message: "Incompatible types in assignment",
      severity: "error",
      rule: "assignment",
    });
  });

  it("maps note severity to info", () => {
    const input =
      'src/app.py:5:1: note: Revealed type is "builtins.int"  [misc]';
    const result = parseMypyOutput(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("info");
  });

  it("returns empty array for clean output", () => {
    expect(parseMypyOutput("")).toEqual([]);
    expect(parseMypyOutput("Success: no issues found")).toEqual([]);
  });
});
