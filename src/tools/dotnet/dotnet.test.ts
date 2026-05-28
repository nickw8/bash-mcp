/**
 * Tests for dotnet tools (dotnet_build, dotnet_test) and their parsers.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerDotnetTools } from "./dotnet.js";
import { parseMSBuildOutput } from "./parsers/msbuild.js";
import { parseTrxResults } from "./parsers/trx.js";

/** Helper to create a server with dotnet tools registered. */
function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerDotnetTools(server);
  return server;
}

describe("registerDotnetTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});

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

describe("parseTrxResults", () => {
  it("parses passing tests", () => {
    const trx = `<?xml version="1.0" encoding="utf-8"?>
<TestRun>
  <Results>
    <UnitTestResult testName="MyApp.Tests.FooTest.ShouldPass" outcome="Passed" />
    <UnitTestResult testName="MyApp.Tests.FooTest.ShouldAlsoPass" outcome="Passed" />
  </Results>
</TestRun>`;

    const result = parseTrxResults(trx);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(2);
    expect(result.results).toEqual([]);
  });

  it("parses failing tests with error details", () => {
    const trx = `<?xml version="1.0" encoding="utf-8"?>
<TestRun>
  <Results>
    <UnitTestResult testName="MyApp.Tests.FooTest.ShouldFail" outcome="Failed">
      <Output>
        <ErrorInfo>
          <Message>Expected True but got False</Message>
          <StackTrace>   at FooTest.ShouldFail() in /src/FooTest.cs:line 42
   at System.RuntimeMethodHandle.InvokeMethod()
   at System.Reflection.RuntimeMethodInfo.Invoke()</StackTrace>
        </ErrorInfo>
      </Output>
    </UnitTestResult>
    <UnitTestResult testName="MyApp.Tests.FooTest.ShouldPass" outcome="Passed" />
  </Results>
</TestRun>`;

    const result = parseTrxResults(trx);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(2);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.name).toBe("FooTest.ShouldFail");
    expect(result.results[0]!.failureMessage).toContain(
      "Expected True but got False",
    );
  });

  it("handles skipped tests", () => {
    const trx = `<TestRun><Results>
      <UnitTestResult testName="Test.Skip" outcome="NotExecuted" />
    </Results></TestRun>`;

    const result = parseTrxResults(trx);
    expect(result.skipped).toBe(1);
    expect(result.total).toBe(1);
  });

  it("strips common namespace prefix", () => {
    const trx = `<TestRun><Results>
      <UnitTestResult testName="MyApp.Tests.Services.AuthTests.Fail1" outcome="Failed">
        <Output><ErrorInfo><Message>err</Message></ErrorInfo></Output>
      </UnitTestResult>
      <UnitTestResult testName="MyApp.Tests.Services.AuthTests.Fail2" outcome="Failed">
        <Output><ErrorInfo><Message>err</Message></ErrorInfo></Output>
      </UnitTestResult>
    </Results></TestRun>`;

    const result = parseTrxResults(trx);
    expect(result.results[0]!.name).toBe("AuthTests.Fail1");
    expect(result.results[1]!.name).toBe("AuthTests.Fail2");
  });

  it("returns empty results for empty TRX", () => {
    const trx = `<TestRun><Results></Results></TestRun>`;
    const result = parseTrxResults(trx);
    expect(result.total).toBe(0);
    expect(result.results).toEqual([]);
  });
});
