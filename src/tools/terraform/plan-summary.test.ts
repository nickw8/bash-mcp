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

/**
 * A replace, an update, and a plain create — one of each counting rule.
 * `stream` is the word `terraform plan -json` uses for the same change.
 */
const ADDRESSES = [
  {
    addr: "aws_instance.web",
    type: "aws_instance",
    actions: ["delete", "create"],
    stream: "replace",
  },
  {
    addr: "aws_s3_bucket.logs",
    type: "aws_s3_bucket",
    actions: ["update"],
    stream: "update",
  },
  {
    addr: "aws_vpc.main",
    type: "aws_vpc",
    actions: ["create"],
    stream: "create",
  },
];

const streamLine = (
  type: string,
  addr: string,
  rtype: string,
  action: string,
) =>
  JSON.stringify({
    type,
    change: { action, resource: { addr, resource_type: rtype } },
  });

/**
 * `terraform plan -json` stream form, with a drift line that must not count
 * and no `change_summary`, so the tally is what is tested.
 */
const planStream = [
  ...ADDRESSES.map((r) =>
    streamLine("planned_change", r.addr, r.type, r.stream),
  ),
  streamLine("resource_drift", "aws_iam_role.ci", "aws_iam_role", "update"),
].join("\n");

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

    const { noChanges: _, ...saved } = parsePlanJson(planShow);

    expect(streamed.structuredContent).toMatchObject(saved);
    expect(saved.changes[0]?.action).toBe("replace");
  });

  it("takes terraform's change_summary totals over the tally", async () => {
    const summary = JSON.stringify({
      type: "change_summary",
      changes: { add: 5, change: 0, remove: 4, operation: "plan" },
    });
    execMock.mockResolvedValue(execOk(`${planStream}\n${summary}`));
    const plan = captureHandler(registerTerraformTools, "tf_plan_summary");
    const result = await plan({ cwd: "." });

    expect(result.structuredContent).toMatchObject({
      add: 5,
      change: 0,
      destroy: 4,
    });
  });
});
