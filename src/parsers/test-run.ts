/**
 * Test run: one test CLI invocation read as a test report. The module every
 * Test tool (npm_test, python_test, dotnet_test, bash_test) hands its CLI call
 * to, so the run → read → parse → answer path is decided in one place:
 *
 *   - the CLI never ran or timed out        → classified `err` (even if a
 *                                             partial artifact exists)
 *   - no artifact, or blank output          → `err` carrying the output's tail
 *   - the artifact is unreadable            → `err` of kind parse_failed
 *   - otherwise                             → `ok` with the tool's payload
 *
 * The module owns the exec call because the artifact path goes into the args.
 * `file` and `dir` artifacts live in a fresh `mkdtemp` directory (so concurrent
 * runs never share a path) that is removed afterwards. The tool keeps its
 * binary, args, parser and payload shape.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyError } from "#error";
import { type ExecResult, exec } from "#exec";
import { err, ok } from "#response";
import type { TestSuite } from "./types.js";

export interface TestRunOpts<
  A extends string | string[],
  R,
  P extends Record<string, unknown>,
> {
  /** The CLI's name, for the error answered when it never ran, timed out, or failed unreadably. */
  command: string;
  /** Build the argv; `artifactPath` is the file or directory the CLI should write (empty for `stdout`). */
  args: (artifactPath: string) => string[];
  /**
   * Where the report comes from: `file` (one path the CLI writes), `dir` (a
   * directory of `suffix` files, parsed together as a `string[]`), or `stdout`
   * (the CLI's output text).
   */
  artifact: "file" | "dir" | "stdout";
  /** `dir` only: which files in the directory are reports (e.g. `.trx`). */
  suffix?: string;
  /** `stdout` only: the report text; default `stdout || stderr`. */
  output?: (result: ExecResult) => string;
  /** `stdout` only: hand blank output to `parse` instead of answering an error. */
  parseBlank?: boolean;
  /** Read the artifact into the tool's result. A throw becomes a parse_failed error. */
  parse: (artifact: A) => R;
  /** Turn the parsed result (and the CLI's result) into the tool's success payload. */
  payload: (parsed: R, result: ExecResult) => P;
  /** The tool's own fields for an error answer, e.g. `{ exitCode }`. */
  errorFields?: (result: ExecResult) => Record<string, unknown>;
  cwd?: string;
  timeout?: number;
}

/** Keep `last` characters of the CLI's output as the failure message. */
const TAIL = 500;

/** Run a test CLI and answer with the tool's payload or a typed error. */
export async function testRun<
  A extends string | string[],
  R,
  P extends Record<string, unknown>,
>(o: TestRunOpts<A, R, P>) {
  const dir =
    o.artifact === "stdout"
      ? ""
      : mkdtempSync(join(tmpdir(), "bash-mcp-test-"));
  try {
    const artifactPath = o.artifact === "file" ? join(dir, "report") : dir;
    const result = await exec(o.command, o.args(artifactPath), {
      cwd: o.cwd,
      timeout: o.timeout,
    });
    const fields = o.errorFields?.(result) ?? {};

    // A run that never started or was killed has no report to trust.
    if (result.errorCode || result.timedOut) {
      const error = classifyError(result, o.command);
      return err(error.message, fields, error);
    }

    const artifact = readArtifact(o, result, artifactPath);
    const empty = Array.isArray(artifact)
      ? artifact.length === 0
      : !artifact?.trim();
    if (artifact === undefined || (empty && !o.parseBlank)) {
      const output = `${result.stdout}\n${result.stderr}`.trim();
      const tail = output.slice(-TAIL) || "No test output received";
      const error = classifyError(result, o.command);
      return err(tail, fields, { ...error, message: tail });
    }

    let parsed: R;
    try {
      parsed = o.parse(artifact as A);
    } catch {
      const text = Array.isArray(artifact) ? artifact.join("\n") : artifact;
      const message = `Failed to parse ${o.command} output: ${text.slice(0, TAIL)}`;
      return err(message, fields, {
        kind: "parse_failed",
        message,
        command: o.command,
      });
    }
    return ok(o.payload(parsed, result));
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** The report text (or texts), or undefined when the CLI left none behind. */
function readArtifact<
  A extends string | string[],
  R,
  P extends Record<string, unknown>,
>(
  o: TestRunOpts<A, R, P>,
  result: ExecResult,
  path: string,
): string | string[] | undefined {
  if (o.artifact === "stdout") {
    return o.output ? o.output(result) : result.stdout || result.stderr;
  }
  try {
    if (o.artifact === "file") return readFileSync(path, "utf8");
    const suffix = o.suffix ?? "";
    // readdir order, one report per test project
    return readdirSync(path)
      .filter((f) => f.endsWith(suffix))
      .map((f) => readFileSync(join(path, f), "utf8"));
  } catch {
    // The CLI failed before writing its report.
    return undefined;
  }
}

/** Without `verbose`, keep only each suite's failed tests. */
export function onlyFailures(suites: TestSuite[], verbose?: boolean) {
  if (verbose) return suites;
  return suites.map((s) => ({
    ...s,
    tests: s.tests.filter((t) => t.status === "failed"),
  }));
}
