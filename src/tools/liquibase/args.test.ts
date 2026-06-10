/**
 * Tests for the pure liquibaseArgs builder.
 */

import { describe, expect, it } from "vitest";
import { liquibaseArgs } from "./args.js";

describe("liquibaseArgs", () => {
  it("puts global flags before the command and scoped flags after", () => {
    expect(
      liquibaseArgs("validate", {
        defaultsFile: "db-dev.properties",
        labels: "eq-4070",
      }),
    ).toEqual([
      "--defaults-file=db-dev.properties",
      "validate",
      "--labels=eq-4070",
    ]);
  });

  it("supports multi-token commands and trailing extraArgs", () => {
    expect(
      liquibaseArgs(["status", "--verbose"], {
        defaultsFile: "p",
        contexts: "prod",
        extraArgs: ["--log-level=info"],
      }),
    ).toEqual([
      "--defaults-file=p",
      "status",
      "--verbose",
      "--contexts=prod",
      "--log-level=info",
    ]);
  });

  it("includes changelog-file as a global flag when given", () => {
    expect(
      liquibaseArgs("updateSQL", { changelogFile: "changelog.xml" }),
    ).toEqual(["--changelog-file=changelog.xml", "updateSQL"]);
  });

  it("emits just the command when no options are set", () => {
    expect(liquibaseArgs("validate", {})).toEqual(["validate"]);
  });
});
