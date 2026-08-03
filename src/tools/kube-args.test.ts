/**
 * Tests for the shared kube inputs.
 *
 * The context flags are worth pinning because the two CLIs keep different
 * spellings — a helper that emitted one flag for both would look right and
 * silently target the wrong cluster. namespaceSchema is worth pinning because
 * its default is what makes `?? "default"` dead in every handler body.
 */

import { describe, expect, it } from "vitest";
import { helmContext, kubectlContext, namespaceSchema } from "#kube-args";

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

describe("namespaceSchema", () => {
  it("fills in `default` before the handler sees it", () => {
    expect(namespaceSchema.parse(undefined)).toBe("default");
  });

  it("passes an explicit namespace through", () => {
    expect(namespaceSchema.parse("kube-system")).toBe("kube-system");
  });
});
