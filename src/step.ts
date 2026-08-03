/**
 * Guarded Step Runner
 *
 * The single chokepoint for BASH_MCP_MODE gating across the multi-command
 * runners (`batch`, `run_seq`): gate → spawn → shape. It sits above both the
 * spawn layer and Shaping, which is why it is its own module rather than part
 * of either (ADR-0003).
 */

import { exec } from "#exec";
import { checkCommandAllowed } from "#safety";
import { type ShapeOptions, shapeOutput } from "#shape";

/** A single command to run through {@link runStep}. */
export interface RunStepInput {
  command: string;
  args?: string[];
  cwd?: string;
  timeout?: number;
  /** Label for this step in the results (defaults to the command name). */
  label?: string;
}

/** Result of running one {@link runStep} (shape shared by batch/run_seq). */
export interface RunStepResult {
  label: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Wall-clock execution time in milliseconds (0 when blocked). */
  elapsed: number;
  /** True when blocked by BASH_MCP_MODE before executing. */
  blocked: boolean;
}

/**
 * Run one command through the full guarded pipeline:
 * `checkCommandAllowed` → `exec` → `shapeOutput` → elapsed timing, so the
 * safety check can't drift between copies. A blocked command resolves with
 * `exitCode: 126`, `blocked: true`, and the reason in `stderr` — exactly as
 * `run`/`batch` did inline.
 */
export async function runStep(
  step: RunStepInput,
  shape: ShapeOptions = {},
): Promise<RunStepResult> {
  const args = step.args ?? [];
  const label = step.label ?? step.command;

  const gate = checkCommandAllowed(step.command, args);
  if (!gate.allowed) {
    return {
      label,
      exitCode: 126,
      stdout: "",
      stderr: gate.reason ?? "blocked by BASH_MCP_MODE",
      elapsed: 0,
      blocked: true,
    };
  }

  const start = Date.now();
  const result = await exec(step.command, args, {
    cwd: step.cwd,
    timeout: step.timeout,
  });

  return {
    label,
    exitCode: result.exitCode,
    stdout: shapeOutput(result.stdout, shape).text,
    stderr: shapeOutput(result.stderr, shape).text,
    elapsed: Date.now() - start,
    blocked: false,
  };
}
