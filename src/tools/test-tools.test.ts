/**
 * The four test tools (npm_test, python_test, dotnet_test, bash_test) through
 * their handlers with `exec` mocked. Success shapes are the contract
 * (ADR-0009/0010); the `it.fails` cases pin the failure policy the shared Test
 * run is meant to give them — missing binary and timeout classified, no output
 * carries a typed tail, unreadable output is parse_failed, and concurrent runs
 * never share an artifact path.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { captureHandler, execFail, execOk } from "../test-support.js";

vi.mock("#safety", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#safety")>();
  return { ...actual, checkCommandAllowed: vi.fn(actual.checkCommandAllowed) };
});

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#exec")>();
  return { ...actual, exec: vi.fn() };
});

const { exec } = await import("#exec");
const { checkCommandAllowed } = await import("#safety");
const execMock = vi.mocked(exec);
const { registerNpmTools } = await import("./npm/npm.js");
const { registerPythonTools } = await import("./python/python.js");
const { registerDotnetTools } = await import("./dotnet/dotnet.js");
const { registerShellTools } = await import("./shell/shell.js");

const npmTest = captureHandler(registerNpmTools, "npm_test");
const pythonTest = captureHandler(registerPythonTools, "python_test");
const dotnetTest = captureHandler(registerDotnetTools, "dotnet_test");
const bashTest = captureHandler(registerShellTools, "bash_test");

const VITEST_JSON = JSON.stringify({
  numTotalTests: 2,
  numPassedTests: 1,
  numFailedTests: 1,
  testResults: [
    {
      name: "/p/a.test.ts",
      assertionResults: [
        { title: "ok", ancestorTitles: ["s"], status: "passed", duration: 1 },
        {
          title: "bad",
          ancestorTitles: ["s"],
          status: "failed",
          duration: 2,
          failureMessages: ["boom"],
        },
      ],
    },
  ],
});

const PYTEST_XML = `<testsuites><testsuite name="pytest">
<testcase classname="tests.test_a" name="test_ok" time="0.001"/>
<testcase classname="tests.test_a" name="test_bad" time="0.002"><failure message="boom">trace</failure></testcase>
</testsuite></testsuites>`;

const TRX = `<TestRun><Results>
<UnitTestResult testName="A.Tests.Ok" outcome="Passed" />
<UnitTestResult testName="A.Tests.Bad" outcome="Failed"><Output><ErrorInfo><Message>boom</Message></ErrorInfo></Output></UnitTestResult>
</Results></TestRun>`;

const BATS =
  "1..2\nok 1 fine\nnot ok 2 broken\n# (in test file t.bats, line 3)\n";

const missingBinary = {
  stdout: "",
  stderr: "",
  exitCode: 1,
  timedOut: false,
  errorCode: "ENOENT",
};
const timedOut = {
  stdout: "",
  stderr: "",
  exitCode: 1,
  timedOut: true,
  signal: "SIGTERM",
};

/** The path a `--flag=` / `--flag:` argument carries. */
function argValue(args: readonly string[], prefix: RegExp): string {
  const hit = args.find((a) => prefix.test(a));
  if (!hit) throw new Error(`no ${prefix} arg in ${args.join(" ")}`);
  return hit.replace(prefix, "");
}

/** Make the mocked pytest write its junit XML where it was told to. */
function pytestWrites(xml: string, exitCode = 1) {
  execMock.mockImplementation(async (_cmd, args) => {
    writeFileSync(argValue(args ?? [], /^--junitxml=/), xml);
    return { ...execOk(""), exitCode };
  });
}

/** Make the mocked dotnet write a .trx into its results directory. */
function dotnetWrites(trx: string, exitCode = 1) {
  execMock.mockImplementation(async (_cmd, args) => {
    const dir = argValue(args ?? [], /^--results-directory:/);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "r.trx"), trx);
    return { ...execOk(""), exitCode };
  });
}

beforeAll(() => {
  // bash_test runs a script; let the safety gate through.
  vi.stubEnv("BASH_MCP_MODE", "off");
});

beforeEach(() => {
  execMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("npm_test", () => {
  it("lists only failures by default", async () => {
    execMock.mockResolvedValue({ ...execOk(VITEST_JSON), exitCode: 1 });
    const r = await npmTest({ cwd: "/p" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.summary).toMatchObject({
      total: 2,
      passed: 1,
      failed: 1,
    });
    expect(r.structuredContent.suites[0].tests).toEqual([
      expect.objectContaining({ status: "failed", failureMessage: "boom" }),
    ]);
  });

  it("lists every test when verbose", async () => {
    execMock.mockResolvedValue(execOk(VITEST_JSON));
    const r = await npmTest({ cwd: "/p", verbose: true });
    expect(r.structuredContent.suites[0].tests).toHaveLength(2);
  });

  it("skips non-JSON lines before the report", async () => {
    execMock.mockResolvedValue(execOk(`warning: deprecated\n${VITEST_JSON}`));
    const r = await npmTest({ cwd: "/p" });
    expect(r.structuredContent.summary.total).toBe(2);
  });

  it("answers an error for blank output", async () => {
    execMock.mockResolvedValue(execOk(""));
    const r = await npmTest({ cwd: "/p" });
    expect(r.isError).toBe(true);
  });

  it.fails("classifies a missing npx as missing_binary", async () => {
    execMock.mockResolvedValue(missingBinary);
    const r = await npmTest({ cwd: "/p" });
    expect(r.structuredContent.error.kind).toBe("missing_binary");
  });

  it.fails("classifies a timeout as timeout", async () => {
    execMock.mockResolvedValue(timedOut);
    const r = await npmTest({ cwd: "/p" });
    expect(r.structuredContent.error.kind).toBe("timeout");
  });

  it.fails("types blank output as command_failed", async () => {
    execMock.mockResolvedValue(execFail("", 1));
    const r = await npmTest({ cwd: "/p" });
    expect(r.structuredContent.error.kind).toBe("command_failed");
  });

  it.fails("answers parse_failed for garbage output", async () => {
    execMock.mockResolvedValue(execOk("{not json at all"));
    const r = await npmTest({ cwd: "/p" });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.kind).toBe("parse_failed");
  });
});

describe("python_test", () => {
  it("lists only failures by default", async () => {
    pytestWrites(PYTEST_XML);
    const r = await pythonTest({ cwd: "/p" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.summary).toMatchObject({
      total: 2,
      passed: 1,
      failed: 1,
    });
    expect(r.structuredContent.suites[0].tests).toHaveLength(1);
    expect(r.structuredContent.suites[0].tests[0].status).toBe("failed");
  });

  it("verbose adds nothing: parsePytestResults keeps only failures", async () => {
    pytestWrites(PYTEST_XML);
    const r = await pythonTest({ cwd: "/p", verbose: true });
    expect(r.structuredContent.suites[0].tests).toHaveLength(1);
  });

  it("passes -k and the path through", async () => {
    pytestWrites(PYTEST_XML);
    await pythonTest({ cwd: "/p", pattern: "auth", path: "tests/x.py" });
    const args = execMock.mock.calls[0]?.[1] ?? [];
    expect(args).toEqual(expect.arrayContaining(["-k", "auth", "tests/x.py"]));
  });

  it("answers the output tail when no XML was produced", async () => {
    execMock.mockResolvedValue(execFail("ModuleNotFoundError: nope", 2));
    const r = await pythonTest({ cwd: "/p" });
    expect(r.isError).toBe(true);
    expect(r.content?.[0]?.text).toContain("ModuleNotFoundError");
  });

  it.fails("classifies a missing python3 as missing_binary", async () => {
    execMock.mockResolvedValue(missingBinary);
    const r = await pythonTest({ cwd: "/p" });
    expect(r.structuredContent.error.kind).toBe("missing_binary");
  });

  it.fails("classifies a timeout as timeout, even with a partial XML", async () => {
    execMock.mockImplementation(async (_cmd, args) => {
      writeFileSync(argValue(args ?? [], /^--junitxml=/), PYTEST_XML);
      return timedOut;
    });
    const r = await pythonTest({ cwd: "/p" });
    expect(r.structuredContent.error.kind).toBe("timeout");
  });

  it.fails("types a run with no XML as command_failed", async () => {
    execMock.mockResolvedValue(execFail("ModuleNotFoundError: nope", 2));
    const r = await pythonTest({ cwd: "/p" });
    expect(r.structuredContent.error.kind).toBe("command_failed");
  });

  it.fails("gives concurrent runs distinct artifact paths", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1);
    const paths: string[] = [];
    execMock.mockImplementation(async (_cmd, args) => {
      const p = argValue(args ?? [], /^--junitxml=/);
      paths.push(p);
      writeFileSync(p, PYTEST_XML);
      return { ...execOk(""), exitCode: 1 };
    });
    await Promise.all([pythonTest({ cwd: "/p" }), pythonTest({ cwd: "/p" })]);
    expect(new Set(paths).size).toBe(2);
  });
});

describe("dotnet_test", () => {
  it("answers counts and only the failures", async () => {
    dotnetWrites(TRX);
    const r = await dotnetTest({ cwd: "/nonexistent-dir", project: "a.sln" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({
      exitCode: 1,
      passed: 1,
      failed: 1,
      skipped: 0,
      total: 2,
      summary: "1 passed, 1 failed",
    });
    expect(r.structuredContent.failures).toHaveLength(1);
  });

  it("answers exitCode and a summary when no TRX was produced", async () => {
    execMock.mockResolvedValue(execFail("MSBUILD : error MSB1009", 1));
    const r = await dotnetTest({ cwd: "/nonexistent-dir", project: "a.sln" });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      exitCode: 1,
      summary: "No TRX output produced",
    });
    expect(r.content?.[0]?.text).toContain("MSB1009");
  });

  it.fails("classifies a missing dotnet as missing_binary", async () => {
    execMock.mockResolvedValue(missingBinary);
    const r = await dotnetTest({ cwd: "/nonexistent-dir", project: "a.sln" });
    expect(r.structuredContent.error.kind).toBe("missing_binary");
  });

  it.fails("classifies a timeout as timeout", async () => {
    execMock.mockResolvedValue(timedOut);
    const r = await dotnetTest({ cwd: "/nonexistent-dir", project: "a.sln" });
    expect(r.structuredContent.error.kind).toBe("timeout");
  });

  it.fails("gives concurrent runs distinct results directories", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1);
    const dirs: string[] = [];
    execMock.mockImplementation(async (_cmd, args) => {
      const dir = argValue(args ?? [], /^--results-directory:/);
      dirs.push(dir);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "r.trx"), TRX);
      return { ...execOk(""), exitCode: 1 };
    });
    await Promise.all([
      dotnetTest({ cwd: "/nonexistent-dir", project: "a.sln" }),
      dotnetTest({ cwd: "/nonexistent-dir", project: "a.sln" }),
    ]);
    expect(new Set(dirs).size).toBe(2);
  });
});

describe("bash_test", () => {
  it("partitions TAP results and keeps the exit code", async () => {
    execMock.mockResolvedValue({ ...execOk(BATS), exitCode: 1 });
    const r = await bashTest({ file: "t.bats" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({
      summary: { passed: 1, failed: 1, total: 2 },
      passed: ["fine"],
      failed: [{ name: "broken" }],
      skipped: [],
      exitCode: 1,
    });
    expect(execMock.mock.calls[0]?.slice(0, 2)).toEqual([
      "bats",
      ["--tap", "t.bats"],
    ]);
  });

  it("reads TAP from stderr too", async () => {
    execMock.mockResolvedValue(execFail(BATS, 1));
    const r = await bashTest({ file: "t.bats" });
    expect(r.structuredContent.summary).toMatchObject({ total: 2 });
  });

  it("answers missing_binary with exitCode 127", async () => {
    execMock.mockResolvedValue(missingBinary);
    const r = await bashTest({ file: "t.bats" });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      exitCode: 127,
      error: { kind: "missing_binary", command: "bats" },
    });
  });

  it("refuses to run when the safety gate blocks it", async () => {
    vi.mocked(checkCommandAllowed).mockReturnValueOnce({
      allowed: false,
      reason: "blocked",
    });
    const r = await bashTest({ file: "t.sh" });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({
      exitCode: 126,
      error: { kind: "permission_denied", command: "bash" },
    });
    expect(execMock).not.toHaveBeenCalled();
  });

  it.fails("classifies a timeout as timeout", async () => {
    execMock.mockResolvedValue(timedOut);
    const r = await bashTest({ file: "t.bats" });
    expect(r.structuredContent.error.kind).toBe("timeout");
  });
});
