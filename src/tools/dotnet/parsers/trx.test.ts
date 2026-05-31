/**
 * Tests for the TRX (dotnet test) result parser.
 */

import { describe, expect, it } from "vitest";
import { parseTrxResults } from "./trx.js";

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
