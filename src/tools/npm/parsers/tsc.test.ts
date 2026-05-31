/**
 * Tests for the tsc diagnostic parser.
 */

import { describe, expect, it } from "vitest";
import { parseTscOutput } from "./tsc.js";

describe("parseTscOutput", () => {
  it("parses tsc error lines", () => {
    const input = `src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/util.ts(3,1): error TS2304: Cannot find name 'foo'.`;

    const result = parseTscOutput(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      file: "src/app.ts",
      line: 10,
      column: 5,
      message: "Type 'string' is not assignable to type 'number'.",
      severity: "error",
      rule: "TS2322",
    });
  });

  it("returns empty array for clean output", () => {
    expect(parseTscOutput("")).toEqual([]);
    expect(parseTscOutput("No errors found.")).toEqual([]);
  });
});
