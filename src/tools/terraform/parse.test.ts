/**
 * Fixture-driven tests for the pure Terraform JSON parsers.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseBackend,
  parseModules,
  parseOutputs,
  parsePlanJson,
  parseProviders,
  parseValidate,
} from "./parse.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/terraform",
);
function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as T;
}

describe("parseOutputs", () => {
  const outputs = parseOutputs(load("outputs.json"));

  it("lists outputs with type", () => {
    const vpc = outputs.find((o) => o.name === "vpc_id");
    expect(vpc).toMatchObject({ type: "string", sensitive: false });
    expect(vpc?.value).toBe("vpc-0abc123");
  });

  it("redacts sensitive values", () => {
    const pw = outputs.find((o) => o.name === "db_password");
    expect(pw?.sensitive).toBe(true);
    expect(pw?.value).toBeUndefined();
  });

  it("stringifies complex types/values", () => {
    const subnets = outputs.find((o) => o.name === "subnet_ids");
    expect(subnets?.value).toBe('["subnet-1","subnet-2"]');
    expect(subnets?.type).toBe('["list","string"]');
  });
});

describe("parseProviders", () => {
  it("extracts terraform version and provider selections", () => {
    const r = parseProviders(load("version.json"));
    expect(r.version).toBe("1.7.5");
    expect(r.providers).toHaveLength(2);
    expect(r.providers[0]).toEqual({
      name: "aws",
      source: "registry.terraform.io/hashicorp/aws",
      version: "5.31.0",
    });
  });
});

describe("parseValidate", () => {
  it("summarizes validate diagnostics", () => {
    const r = parseValidate(load("validate.json"));
    expect(r.valid).toBe(false);
    expect(r.errorCount).toBe(1);
    expect(r.warningCount).toBe(1);
    expect(r.diagnostics[0]).toMatchObject({
      severity: "error",
      file: "main.tf",
      line: 12,
    });
  });

  it("handles a clean validate result", () => {
    const r = parseValidate({ valid: true, error_count: 0, warning_count: 0 });
    expect(r.valid).toBe(true);
    expect(r.diagnostics).toHaveLength(0);
  });
});

describe("parseModules", () => {
  it("lists modules excluding the root module", () => {
    const mods = parseModules(load("modules.json"));
    expect(mods).toHaveLength(2);
    expect(mods[0]).toEqual({
      key: "vpc",
      source: "terraform-aws-modules/vpc/aws",
      version: "5.1.2",
    });
    expect(mods[1]?.version).toBe(""); // local module has no version
  });
});

describe("parseBackend", () => {
  it("extracts backend type and stringified config", () => {
    const b = parseBackend(load("backend.json"));
    expect(b.type).toBe("s3");
    expect(b.config.bucket).toBe("my-tf-state");
    expect(b.config.encrypt).toBe("true");
  });
});

describe("parsePlanJson", () => {
  it("counts add/change/destroy from resource_changes (replace counts both)", () => {
    const p = parsePlanJson(load("plan.json"));
    expect(p.add).toBe(2); // web create + db replace
    expect(p.change).toBe(1); // s3 update
    expect(p.destroy).toBe(1); // db replace
    expect(p.changes).toHaveLength(3); // no-op excluded
    expect(p.noChanges).toBe(false);
  });

  it("reports noChanges for an empty plan", () => {
    expect(parsePlanJson({ resource_changes: [] }).noChanges).toBe(true);
  });
});
