/**
 * Task-level gate (scripts/task-eval.mjs): every scenario keeps its evidence
 * and costs fewer tokens than the raw commands that answer the same question.
 */
import { describe, expect, it } from "vitest";
import { evaluate } from "../scripts/task-eval.mjs";

describe("task-level evaluation", () => {
  const rows = evaluate();

  it("covers the six v5 scenarios", () => {
    expect(rows.map((r: { id: string }) => r.id)).toEqual([
      "k8s-pod-failure",
      "gitlab-ci-failure",
      "dotnet-build-test",
      "terraform-plan",
      "git-mr-context",
      "source-exploration",
    ]);
  });

  for (const r of rows) {
    it(`${r.id}: evidence survives and tokens drop`, () => {
      expect(r.missingInRaw).toEqual([]);
      expect(r.missingInMcp).toEqual([]);
      expect(r.mcpT).toBeLessThan(r.rawT);
      expect(r.mcpCalls).toBeLessThanOrEqual(r.rawCalls);
    });
  }
});
