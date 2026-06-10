/**
 * Fixture-driven tests for the pure `liquibase validate` parser.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseValidate } from "./validate.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/liquibase",
);
const load = (name: string) => readFileSync(join(fixtures, name), "utf8");

describe("parseValidate", () => {
  it("reports a clean validation as valid", () => {
    const result = parseValidate(load("validate-clean.txt"));
    expect(result).toEqual({ valid: true, errorCount: 0, errors: [] });
  });

  it("collects errors grouped under their category headers", () => {
    const result = parseValidate(load("validate-fail.txt"));
    expect(result.valid).toBe(false);
    expect(result.errorCount).toBe(3);

    const dupes = result.errors.filter((e) =>
      e.message.startsWith("had duplicate identifiers"),
    );
    expect(dupes).toHaveLength(2);
    expect(dupes[0]).toMatchObject({
      changesetId: "ReferralDecisionsStates_Rx_Len450-v0.0.2",
      message: "had duplicate identifiers",
    });
    expect(dupes[0]?.file).toContain("EQ-3849.sql");
  });

  it("keeps trailing detail (checksum drift) in the message", () => {
    const result = parseValidate(load("validate-fail.txt"));
    const checksum = result.errors.find((e) =>
      e.message.startsWith("check sum"),
    );
    expect(checksum).toMatchObject({
      changesetId: "EQ-3454-processclaims-schema-v0.1.0",
      message: "check sum: was: 9:abc123 but is now: 9:def456",
    });
  });

  it("never throws on empty or junk input", () => {
    expect(parseValidate("")).toEqual({
      valid: true,
      errorCount: 0,
      errors: [],
    });
    expect(parseValidate("garbage line\nanother").valid).toBe(true);
  });
});
