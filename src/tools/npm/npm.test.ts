/**
 * Tests for npm tool registration. Parser tests are co-located with the
 * parsers in ./parsers/*.test.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerNpmTools } from "./npm.js";

describe("registerNpmTools", () => {
  it("registers without throwing", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    expect(() => registerNpmTools(server)).not.toThrow();
  });
});
