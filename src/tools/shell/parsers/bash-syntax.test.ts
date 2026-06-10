/**
 * Fixture-driven tests for the pure `bash -n` stderr parser.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBashSyntax } from "./bash-syntax.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/shell",
);
const load = (name: string) => readFileSync(join(fixtures, name), "utf8");

describe("parseBashSyntax", () => {
  it("parses a syntax error and skips the echoed source line", () => {
    const result = parseBashSyntax(load("bash-syntax-error.txt"));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: "e1.sh",
      line: 3,
      column: 0,
      message: "syntax error near unexpected token `echo'",
      severity: "error",
    });
  });

  it("parses an unexpected-EOF error", () => {
    const result = parseBashSyntax(load("bash-syntax-eof.txt"));
    expect(result).toHaveLength(1);
    expect(result[0]?.file).toBe("syntax_bad.sh");
    expect(result[0]?.line).toBe(5);
    expect(result[0]?.message).toContain("unexpected end of file");
  });

  it("returns [] for empty input (valid script)", () => {
    expect(parseBashSyntax("")).toEqual([]);
    expect(parseBashSyntax("\n")).toEqual([]);
  });
});
