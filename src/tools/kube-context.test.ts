/**
 * Tests for the kube-context flag builders.
 *
 * The only thing worth pinning is that the two CLIs keep their different
 * spellings — a helper that emitted one flag for both would look right and
 * silently target the wrong cluster.
 */

import { describe, expect, it } from "vitest";
import { helmContext, kubectlContext } from "#kube-context";

describe("kubectlContext", () => {
  it("spells the flag --context", () => {
    expect(kubectlContext("prod")).toEqual(["--context", "prod"]);
  });

  it("emits nothing without a context", () => {
    expect(kubectlContext(undefined)).toEqual([]);
  });
});

describe("helmContext", () => {
  it("spells the same flag --kube-context", () => {
    expect(helmContext("prod")).toEqual(["--kube-context", "prod"]);
  });

  it("emits nothing without a context", () => {
    expect(helmContext(undefined)).toEqual([]);
  });
});
