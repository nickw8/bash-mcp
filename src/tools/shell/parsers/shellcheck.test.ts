/**
 * Fixture-driven tests for the pure shellcheck JSON parser.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseShellcheckDiagnostics } from "./shellcheck.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/shell",
);
const load = (name: string) => readFileSync(join(fixtures, name), "utf8");

describe("parseShellcheckDiagnostics", () => {
  it("parses -f json1 ({ comments: [...] }) with severity + SC code mapping", () => {
    const result = parseShellcheckDiagnostics(load("shellcheck-json1.json"));
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      file: "sample.sh",
      line: 2,
      column: 6,
      message: "unquoted is referenced but not assigned.",
      severity: "warning",
      rule: "SC2154",
    });
    // info level (SC2086) maps to "info"
    expect(result[1]?.severity).toBe("info");
    expect(result[1]?.rule).toBe("SC2086");
    // error level passes through
    expect(result[2]?.severity).toBe("error");
    expect(result[2]?.rule).toBe("SC1009");
  });

  it("parses legacy -f json (top-level array) and maps style → info", () => {
    const result = parseShellcheckDiagnostics(
      load("shellcheck-json-array.json"),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("info");
    expect(result[0]?.rule).toBe("SC2006");
    expect(result[0]?.file).toBe("legacy.sh");
  });

  it("returns [] for a clean run ({ comments: [] })", () => {
    expect(parseShellcheckDiagnostics(load("shellcheck-clean.json"))).toEqual(
      [],
    );
  });

  it("returns [] for empty or non-JSON output", () => {
    expect(parseShellcheckDiagnostics("")).toEqual([]);
    expect(parseShellcheckDiagnostics("shellcheck: command failed")).toEqual(
      [],
    );
  });
});
