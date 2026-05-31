/**
 * Tests for Terraform tools (tf_state_list, tf_show, tf_plan_summary, tf_workspaces).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { registerTerraformTools, resolveTfBinary } from "./terraform.js";

function createServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerTerraformTools(server);
  return server;
}

describe("registerTerraformTools", () => {
  it("registers without throwing", () => {
    expect(() => createServer()).not.toThrow();
  });
});

describe("resolveTfBinary", () => {
  const original = process.env.TF_BINARY;
  afterEach(() => {
    if (original === undefined) delete process.env.TF_BINARY;
    else process.env.TF_BINARY = original;
  });

  it("defaults to terraform", () => {
    delete process.env.TF_BINARY;
    expect(resolveTfBinary()).toBe("terraform");
  });

  it("honors TF_BINARY=tofu", () => {
    process.env.TF_BINARY = "tofu";
    expect(resolveTfBinary()).toBe("tofu");
  });

  it("explicit param overrides the env", () => {
    process.env.TF_BINARY = "tofu";
    expect(resolveTfBinary("terraform")).toBe("terraform");
  });

  it("ignores an unrecognized TF_BINARY value", () => {
    process.env.TF_BINARY = "garbage";
    expect(resolveTfBinary()).toBe("terraform");
  });
});
