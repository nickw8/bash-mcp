/**
 * Registration smoke test for the shell tool group. The parsing logic lives in
 * (and is tested via) parsers/*.test.ts; here we only assert the three tools
 * register without throwing. No real binaries are executed.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerShellTools } from "./shell.js";

describe("registerShellTools", () => {
  it("registers bash_syntax_check, bash_lint, and bash_test without throwing", () => {
    const registered: string[] = [];
    const server = {
      registerTool(name: string) {
        registered.push(name);
        return undefined;
      },
    } as unknown as McpServer;

    expect(() => registerShellTools(server)).not.toThrow();
    expect(registered).toContain("bash_syntax_check");
    expect(registered).toContain("bash_lint");
    expect(registered).toContain("bash_test");
  });
});
