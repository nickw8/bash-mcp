import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureHandler, execOk } from "../../test-support.js";
import { parsePlanJson } from "./parse.js";

vi.mock("#exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../exec.js")>();
  return { ...actual, exec: vi.fn() };
});

const { exec } = await import("#exec");
const execMock = vi.mocked(exec);

const { registerTerraformTools } = await import("./terraform.js");

/** A replace, an update, and a plain create — one of each counting rule. */
const ADDRESSES = [
  {
    addr: "aws_instance.web",
    type: "aws_instance",
    actions: ["delete", "create"],
  },
  { addr: "aws_s3_bucket.logs", type: "aws_s3_bucket", actions: ["update"] },
  { addr: "aws_vpc.main", type: "aws_vpc", actions: ["create"] },
];

/** `terraform plan -json` stream form. */
const planStream = ADDRESSES.map((r) =>
  JSON.stringify({
    type: "planned_change",
    change: {
      action: r.actions,
      resource: { addr: r.addr, resource_type: r.type },
    },
  }),
).join("\n");

/** The same plan in `terraform show -json <planfile>` form. */
const planShow = {
  resource_changes: ADDRESSES.map((r) => ({
    address: r.addr,
    type: r.type,
    change: { actions: r.actions },
  })),
};

/**
 * tf_plan_summary has two paths to the same numbers — the `-json` stream it
 * parses inline, and `parsePlanJson` over a saved plan file. They counted
 * replaces differently (the stream's if/else chain scored `["delete","create"]`
 * as a destroy only), so the same plan summarized as 0 adds or 1 depending on
 * whether `planFile` was passed. `tallyActions` is now the single rule; this
 * test is what keeps them from drifting apart again.
 */
describe("tf_plan_summary counting", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it("counts a replace as both an add and a destroy on the stream path", async () => {
    execMock.mockResolvedValue(execOk(planStream));

    const plan = captureHandler(registerTerraformTools, "tf_plan_summary");
    const result = await plan({ cwd: "." });

    expect(result.structuredContent).toMatchObject({
      add: 2,
      change: 1,
      destroy: 1,
      noChanges: false,
    });
  });

  it("agrees with the saved-plan path on the same plan", async () => {
    execMock.mockResolvedValue(execOk(planStream));
    const plan = captureHandler(registerTerraformTools, "tf_plan_summary");
    const streamed = await plan({ cwd: "." });

    const saved = parsePlanJson(planShow);

    expect({
      add: streamed.structuredContent.add,
      change: streamed.structuredContent.change,
      destroy: streamed.structuredContent.destroy,
    }).toEqual({
      add: saved.add,
      change: saved.change,
      destroy: saved.destroy,
    });
  });
});
