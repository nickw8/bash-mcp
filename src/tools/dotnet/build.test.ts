/**
 * Tests for dotnet_build's diagnostic gate + cap policy (selectBuildDiagnostics).
 *
 * Warnings are dropped unless includeWarnings or detailLevel:'full'; the
 * surviving list is capped by the output budget. The handler itself shells out
 * to `dotnet`, so the testable unit is this pure selector.
 */

import { describe, expect, it } from "vitest";
import type { Diagnostic } from "#parsers";
import { selectBuildDiagnostics } from "./build.js";

const diag = (severity: Diagnostic["severity"], i: number): Diagnostic => ({
  file: `F${i}.cs`,
  line: i,
  column: 1,
  message: `m${i}`,
  severity,
});

const errors = (n: number) =>
  Array.from({ length: n }, (_, i) => diag("error", i));
const warnings = (n: number) =>
  Array.from({ length: n }, (_, i) => diag("warning", i));

describe("selectBuildDiagnostics", () => {
  it("omits warnings by default (errors only)", () => {
    const all = [...errors(2), ...warnings(3)];
    const r = selectBuildDiagnostics(all, {});
    expect(r.showWarnings).toBe(false);
    expect(r.diagnostics).toHaveLength(2);
    expect(r.diagnostics.every((d) => d.severity === "error")).toBe(true);
  });

  it("keeps warnings on a green build only when includeWarnings is set", () => {
    const all = warnings(3);
    expect(selectBuildDiagnostics(all, {}).diagnostics).toHaveLength(0);
    const r = selectBuildDiagnostics(all, { includeWarnings: true });
    expect(r.showWarnings).toBe(true);
    expect(r.diagnostics).toHaveLength(3);
  });

  it("detailLevel:'full' includes warnings and does not cap", () => {
    const all = [...errors(150), ...warnings(50)];
    const r = selectBuildDiagnostics(all, { detailLevel: "full" });
    expect(r.showWarnings).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.diagnostics).toHaveLength(200);
  });

  it("caps a large error cascade and reports the original total", () => {
    const r = selectBuildDiagnostics(errors(250), { detailLevel: "summary" });
    expect(r.diagnostics).toHaveLength(20);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(250);
  });

  it("maxItems overrides the detailLevel cap", () => {
    const r = selectBuildDiagnostics(errors(50), { maxItems: 5 });
    expect(r.diagnostics).toHaveLength(5);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(50);
  });

  it("gates before capping (warnings don't consume the budget)", () => {
    const all = [...errors(10), ...warnings(100)];
    const r = selectBuildDiagnostics(all, { maxItems: 20 });
    expect(r.diagnostics).toHaveLength(10);
    expect(r.truncated).toBe(false);
  });
});
