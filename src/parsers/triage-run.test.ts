import { describe, expect, it, vi } from "vitest";
import type { ExecJsonResult } from "#exec";
import { triageRun } from "./triage-run.js";

const probeOf =
  <T>(r: Partial<ExecJsonResult<T>>) =>
  async (): Promise<ExecJsonResult<T>> => ({
    data: null,
    error: null,
    exitCode: 0,
    ...r,
  });
const detail = (kind: "missing_binary" | "timeout" | "not_found") =>
  ({ kind, message: kind }) as const;

const base = {
  empty: { healthy: false, revision: 0 },
  failure: "helm status failed",
  suggestedNextCommands: ["helm_list"],
};

describe("triageRun", () => {
  it.each([
    "missing_binary",
    "timeout",
  ] as const)("errors, carrying the empty fields, when the probe never ran (%s)", async (kind) => {
    const classify = vi.fn();
    const res = await triageRun({
      ...base,
      probe: probeOf({ error: "boom", exitCode: 1, detail: detail(kind) }),
      classify,
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({
      healthy: false,
      revision: 0,
      error: { kind },
    });
    expect(classify).not.toHaveBeenCalled();
  });

  it("answers Unknown with the empty fields when the probe ran and failed", async () => {
    const res = await triageRun({
      ...base,
      probe: probeOf({
        error: "release: not found",
        exitCode: 1,
        detail: detail("not_found"),
      }),
      classify: () => ({}),
    });
    expect("isError" in res).toBe(false);
    expect(res.structuredContent).toEqual({
      healthy: false,
      revision: 0,
      status: "Unknown",
      likelyCauses: [],
      suggestedNextCommands: ["helm_list"],
      evidence: ["helm status failed: release: not found"],
    });
  });

  it("treats a failure with no classification as an answer", async () => {
    const res = await triageRun({
      ...base,
      probe: probeOf({ error: "odd", exitCode: 1 }),
      classify: () => ({}),
    });
    expect(res.structuredContent.status).toBe("Unknown");
  });

  it("answers Unknown when the probe succeeded with no data", async () => {
    const classify = vi.fn();
    const res = await triageRun({ ...base, probe: probeOf({}), classify });
    expect(res.structuredContent.status).toBe("Unknown");
    expect(res.structuredContent.evidence).toEqual([
      "helm status failed: no data",
    ]);
    expect(classify).not.toHaveBeenCalled();
  });

  it("answers the classifier's payload on success, awaiting an async classify", async () => {
    const res = await triageRun({
      ...base,
      probe: probeOf({ data: { v: 3 } }),
      classify: async (d) => ({ status: "Healthy", revision: d.v }),
    });
    expect(res.structuredContent).toEqual({ status: "Healthy", revision: 3 });
  });

  it("hands falsy-but-present data to the classifier", async () => {
    const classify = vi.fn(() => ({ status: "ok" }));
    await triageRun({ ...base, probe: probeOf({ data: 0 }), classify });
    expect(classify).toHaveBeenCalledWith(0);
  });
});
