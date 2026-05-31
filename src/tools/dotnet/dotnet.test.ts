/**
 * Tests for dotnet tool registration. Parser tests are co-located with the
 * parsers in ./parsers/*.test.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerDotnetTools } from "./dotnet.js";

describe("registerDotnetTools", () => {
  it("registers without throwing", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    expect(() => registerDotnetTools(server)).not.toThrow();
  });
});
