/**
 * Tests for the guarded step runner: gate → spawn → shape, in that order.
 * These run real commands, so they need a unix-like environment.
 */

import { afterEach, describe, expect, it } from "vitest";
import { runStep } from "./step.js";

describe("runStep", () => {
  const original = process.env.BASH_MCP_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.BASH_MCP_MODE;
    else process.env.BASH_MCP_MODE = original;
  });

  it("runs an allowed command and reports elapsed + label", async () => {
    process.env.BASH_MCP_MODE = "readOnly";
    const r = await runStep({ command: "echo", args: ["hi"], label: "greet" });
    expect(r.blocked).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("hi");
    expect(r.label).toBe("greet");
    expect(r.elapsed).toBeGreaterThanOrEqual(0);
  });

  it("shapes step output through shapeOutput", async () => {
    process.env.BASH_MCP_MODE = "off";
    const r = await runStep(
      { command: "printf", args: ["a\\nb\\nc\\n"] },
      { mode: "tail", maxLines: 1 },
    );
    expect(r.stdout).toBe("... (2 lines truncated) ...\nc");
  });

  it("blocks a mutating command under readOnly without executing it", async () => {
    process.env.BASH_MCP_MODE = "readOnly";
    const r = await runStep({
      command: "rm",
      args: ["-rf", "/tmp/bash-mcp-x"],
    });
    expect(r.blocked).toBe(true);
    expect(r.exitCode).toBe(126);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("BASH_MCP_MODE");
    expect(r.elapsed).toBe(0);
  });
});
