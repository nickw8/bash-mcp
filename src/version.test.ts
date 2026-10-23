/**
 * Drift guard for the single-sourced package version.
 *
 * The version lives in src/version.ts (read by index.ts and logger.ts). This
 * test asserts it — and every version field in server.json — stays in lockstep
 * with package.json, so a `npm version` bump can't silently desync the MCP
 * server identity, the log context, or the registry manifest.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "./version.js";

// src/version.test.ts → src/ → package root.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = (rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, rel), "utf8"));

describe("version single-source", () => {
  const pkg = readJson("package.json");

  it("src VERSION matches package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("server.json versions match package.json", () => {
    const server = readJson("server.json");
    expect(server.version).toBe(pkg.version);
    const packages = (server.packages ?? []) as { version?: string }[];
    for (const p of packages) {
      expect(p.version).toBe(pkg.version);
    }
  });

  // The MCP Registry verifies npm ownership by matching package.json
  // `mcpName` against server.json `name`; the npm identifier must be this
  // package (the unscoped `bash-mcp` belongs to someone else).
  it("server.json identity matches package.json", () => {
    const server = readJson("server.json") as {
      name: string;
      description: string;
      packages: { identifier: string; registryType: string }[];
    };
    expect(server.name).toBe(pkg.mcpName);
    expect(server.name).toMatch(/^io\.github\.nickw8\//);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.packages).toEqual([
      expect.objectContaining({ registryType: "npm", identifier: pkg.name }),
    ]);
  });
});
