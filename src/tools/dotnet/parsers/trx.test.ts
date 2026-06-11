/**
 * Tests for the TRX (dotnet test) result parser.
 */

import { describe, expect, it } from "vitest";
import { aggregateTrx, parseTrxResults } from "./trx.js";

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

  it("counts self-closing passes that precede a failing test", () => {
    // Regression: a greedy quantifier let the failed element's body branch
    // swallow the preceding self-closing passes, dropping their counts.
    const trx = `<TestRun><Results>
      <UnitTestResult testName="App.Tests.T.Pass1" outcome="Passed" />
      <UnitTestResult testName="App.Tests.T.Pass2" outcome="Passed" />
      <UnitTestResult testName="App.Tests.T.Fail1" outcome="Failed">
        <Output><ErrorInfo><Message>boom</Message></ErrorInfo></Output>
      </UnitTestResult>
    </Results></TestRun>`;

    const result = parseTrxResults(trx);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(3);
  });
});

describe("aggregateTrx", () => {
  const projA = `<TestRun><Results>
    <UnitTestResult testName="ProjA.Tests.FooTest.Pass1" outcome="Passed" />
    <UnitTestResult testName="ProjA.Tests.FooTest.Fail1" outcome="Failed">
      <Output><ErrorInfo><Message>boom A</Message></ErrorInfo></Output>
    </UnitTestResult>
  </Results></TestRun>`;

  const projB = `<TestRun><Results>
    <UnitTestResult testName="ProjB.Tests.BarTest.Pass1" outcome="Passed" />
    <UnitTestResult testName="ProjB.Tests.BarTest.Pass2" outcome="Passed" />
    <UnitTestResult testName="ProjB.Tests.BarTest.Skip1" outcome="NotExecuted" />
    <UnitTestResult testName="ProjB.Tests.BarTest.Fail1" outcome="Failed">
      <Output><ErrorInfo><Message>boom B</Message></ErrorInfo></Output>
    </UnitTestResult>
  </Results></TestRun>`;

  it("sums counts and concatenates failures across files", () => {
    const result = aggregateTrx([projA, projB]);
    expect(result.passed).toBe(3);
    expect(result.failed).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.total).toBe(6);
    expect(result.results).toHaveLength(2);
    expect(result.results.map((r) => r.failureMessage)).toEqual([
      expect.stringContaining("boom A"),
      expect.stringContaining("boom B"),
    ]);
  });

  it("matches single-file parse for one file", () => {
    expect(aggregateTrx([projA])).toEqual(parseTrxResults(projA));
  });

  it("returns a zeroed summary for no files", () => {
    const result = aggregateTrx([]);
    expect(result.total).toBe(0);
    expect(result.results).toEqual([]);
  });
});
