/**
 * Fixture-driven tests for the pure `liquibase status --verbose` parser.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseStatus } from "./status.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/liquibase",
);
const load = (name: string) => readFileSync(join(fixtures, name), "utf8");

describe("parseStatus", () => {
  it("lists pending changesets and trusts the summary count", () => {
    const result = parseStatus(load("status.txt"));
    expect(result.upToDate).toBe(false);
    expect(result.pendingCount).toBe(4);
    expect(result.pending).toHaveLength(4);
    expect(result.pending[0]).toEqual({
      file: "databases/ApplicationConfig/database/DBCreation.sql",
      id: "ApplicationConfigDB-v0.0.5",
      author: "NWEIGHT",
    });
  });

  it("does not treat the success footer as a changeset", () => {
    const result = parseStatus(load("status.txt"));
    expect(result.pending.every((p) => p.file.includes("/"))).toBe(true);
  });

  it("reports an up-to-date database", () => {
    const result = parseStatus(load("status-up-to-date.txt"));
    expect(result).toEqual({ upToDate: true, pendingCount: 0, pending: [] });
  });

  it("never throws on empty input", () => {
    expect(parseStatus("")).toEqual({
      upToDate: true,
      pendingCount: 0,
      pending: [],
    });
  });
});
