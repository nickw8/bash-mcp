/**
 * Tests for the shared Liquibase banner / framing stripper.
 */

import { describe, expect, it } from "vitest";
import { stripBanner } from "./banner.js";

describe("stripBanner", () => {
  it("drops the ASCII-art banner and startup lines", () => {
    const raw = [
      "####################################################",
      "##  Liquibase Open Source 5.0.3 by Liquibase      ##",
      "####################################################",
      "Starting Liquibase at 15:55:01 using Java 26.0.1",
      "Liquibase Version: 5.0.3",
      "",
      "No validation errors found.",
    ].join("\n");
    expect(stripBanner(raw)).toBe("No validation errors found.");
  });

  it("drops updateSQL lock/unlock framing", () => {
    const raw = [
      "-- Lock Database",
      "UPDATE DATABASECHANGELOGLOCK SET LOCKED = 1 WHERE ID = 1",
      "GO",
      "USE CICD;",
      "-- Release Database Lock",
      "UPDATE DATABASECHANGELOGLOCK SET LOCKED = 0 WHERE ID = 1",
    ].join("\n");
    // The stray `GO` survives (it isn't framing), but lock rows are gone.
    expect(stripBanner(raw)).toBe("GO\nUSE CICD;");
  });

  it("strips carriage returns so callers can match on \\n", () => {
    expect(stripBanner("line one\r\nline two\r\n")).toBe("line one\nline two");
  });

  it("never throws on empty input", () => {
    expect(stripBanner("")).toBe("");
  });
});
