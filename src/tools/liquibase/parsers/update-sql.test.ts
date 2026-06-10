/**
 * Fixture-driven tests for the pure `liquibase updateSQL` parser.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseUpdateSql } from "./update-sql.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/liquibase",
);
const load = (name: string) => readFileSync(join(fixtures, name), "utf8");

describe("parseUpdateSql", () => {
  const result = parseUpdateSql(load("update-sql.txt"));

  it("splits one entry per changeset marker", () => {
    expect(result.changesetCount).toBe(4);
    expect(result.changesets.map((c) => c.id)).toEqual([
      "ApplicationConfigDB-v0.0.5",
      "addFeatureFlag-EQ-2949-enable-v0.0.2",
      "GetDataForRebateFalloutReport-EQ-4070-v0.0.5",
      "svc-user-service-grants-v0.1.3",
    ]);
  });

  it("strips the DATABASECHANGELOG tracking row from the SQL body", () => {
    const first = result.changesets[0];
    expect(first?.sql).toContain("CREATE DATABASE [ApplicationConfig]");
    expect(first?.sql).not.toContain("INSERT INTO DATABASECHANGELOG");
    expect(first?.firstStatement).toBe("CREATE DATABASE [ApplicationConfig]");
    expect(first?.sqlLineCount).toBe(2);
  });

  it("reads labels/contexts from the positional INSERT tracking row", () => {
    const first = result.changesets[0];
    expect(first?.contexts).toBeUndefined(); // CONTEXTS = NULL
    expect(first?.labels).toBe("ps-3457");
  });

  it("reads labels/contexts from the named UPDATE (re-ran) tracking row", () => {
    const reran = result.changesets[3];
    expect(reran?.contexts).toBeUndefined(); // CONTEXTS = NULL
    expect(reran?.labels).toBe("security");
    expect(reran?.sqlLineCount).toBe(0); // re-ran: tracking row only, no SQL
  });

  it("passes batchLint for a proc whose CREATE leads its GO-batch", () => {
    const proc = result.changesets[2];
    expect(proc?.batchLint).toEqual({ ok: true });
  });

  it("omits batchLint for changesets with no routine DDL", () => {
    expect(result.changesets[0]?.batchLint).toBeUndefined();
    expect(result.changesets[1]?.batchLint).toBeUndefined();
  });

  it("flags a proc whose CREATE is not first in its batch", () => {
    const bad = parseUpdateSql(load("update-sql-batch-violation.txt"));
    expect(bad.changesetCount).toBe(1);
    expect(bad.changesets[0]?.batchLint).toEqual({
      ok: false,
      reason: "USE precedes CREATE PROCEDURE — DDL not first in batch",
    });
  });

  it("can skip the batch lint when asked", () => {
    const bad = parseUpdateSql(load("update-sql-batch-violation.txt"), {
      batchLint: false,
    });
    expect(bad.changesets[0]?.batchLint).toBeUndefined();
  });

  it("tolerates CRLF line endings inside the SQL body", () => {
    const raw =
      "-- Changeset db/x.sql::cs-1::me\r\n" +
      "CREATE TABLE Foo (Id INT);\r\n" +
      "GO\r\n" +
      "INSERT INTO DATABASECHANGELOG (ID, AUTHOR, FILENAME, DATEEXECUTED, ORDEREXECUTED, MD5SUM, DESCRIPTION, COMMENTS, EXECTYPE, CONTEXTS, LABELS, LIQUIBASE, DEPLOYMENT_ID) VALUES ('cs-1', 'me', 'db/x.sql', GETDATE(), 1, '9:x', 'sql', NULL, 'EXECUTED', NULL, 'eq-1', '5.0.3', '42')\r\n";
    const crlf = parseUpdateSql(raw);
    expect(crlf.changesetCount).toBe(1);
    expect(crlf.changesets[0]?.sql).toBe("CREATE TABLE Foo (Id INT);\nGO");
    expect(crlf.changesets[0]?.labels).toBe("eq-1");
    expect(crlf.changesets[0]?.firstStatement).toBe(
      "CREATE TABLE Foo (Id INT);",
    );
  });

  it("never throws on empty input", () => {
    expect(parseUpdateSql("")).toEqual({ changesetCount: 0, changesets: [] });
  });
});
