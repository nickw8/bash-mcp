/**
 * Tests for the MSBuild diagnostic parser.
 */

import { describe, expect, it } from "vitest";
import { parseMSBuildOutput } from "./msbuild.js";

describe("parseMSBuildOutput", () => {
  it("parses error and warning lines", () => {
    const output = [
      "/home/user/project/src/Services/Foo.cs(12,5): error CS0618: 'Bar' is obsolete",
      "/home/user/project/src/Models/Baz.cs(8,1): warning CS0168: The variable 'x' is declared but never used",
      "Build FAILED.",
    ].join("\n");

    const diagnostics = parseMSBuildOutput(output);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toEqual({
      file: "Services/Foo.cs",
      line: 12,
      column: 5,
      severity: "error",
      rule: "CS0618",
      message: "'Bar' is obsolete",
    });
    expect(diagnostics[1]).toEqual({
      file: "Models/Baz.cs",
      line: 8,
      column: 1,
      severity: "warning",
      rule: "CS0168",
      message: "The variable 'x' is declared but never used",
    });
  });

  it("returns empty array for clean build output", () => {
    const output = "Build succeeded.\n    0 Warning(s)\n    0 Error(s)";
    expect(parseMSBuildOutput(output)).toEqual([]);
  });

  it("truncates long messages", () => {
    const longMsg = "A".repeat(300);
    const output = `/home/user/src/Foo.cs(1,1): error CS0001: ${longMsg}`;
    const diagnostics = parseMSBuildOutput(output);
    expect(diagnostics[0]!.message.length).toBeLessThanOrEqual(201); // 200 + ellipsis
  });

  it("strips common path prefix", () => {
    const output = [
      "/home/user/project/src/A.cs(1,1): error CS001: err1",
      "/home/user/project/src/B.cs(2,2): warning CS002: warn1",
    ].join("\n");

    const diagnostics = parseMSBuildOutput(output);
    expect(diagnostics[0]!.file).toBe("A.cs");
    expect(diagnostics[1]!.file).toBe("B.cs");
  });
});
