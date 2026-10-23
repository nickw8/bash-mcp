/**
 * Tests for the shared kube inputs.
 *
 * The context flags are worth pinning because the two CLIs keep different
 * spellings — a helper that emitted one flag for both would look right and
 * silently target the wrong cluster. namespaceSchema is worth pinning because
 * its default is what makes `?? "default"` dead in every handler body.
 */

import { describe, expect, it } from "vitest";
import {
  allNamespacesSchema,
  contextSchema,
  helmContext,
  kubectlContext,
  namespaceSchema,
  namespaceScope,
} from "#kube-args";

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

describe("namespaceScope", () => {
  it("scopes to one namespace with -n", () => {
    expect(namespaceScope("kube-system")).toEqual(["-n", "kube-system"]);
  });

  it("asks for all namespaces without -n", () => {
    expect(namespaceScope(undefined, true)).toEqual(["--all-namespaces"]);
  });

  it("lets allNamespaces win over a namespace, never passing both", () => {
    expect(namespaceScope("default", true)).toEqual(["--all-namespaces"]);
  });

  it("emits nothing when neither is given, or allNamespaces is false", () => {
    expect(namespaceScope()).toEqual([]);
    expect(namespaceScope(undefined, false)).toEqual([]);
    expect(namespaceScope("prod", false)).toEqual(["-n", "prod"]);
  });
});

describe("contextSchema and allNamespacesSchema", () => {
  it("are optional with one description each", () => {
    expect(contextSchema.parse(undefined)).toBeUndefined();
    expect(contextSchema.description).toBe("Kube context");
    expect(allNamespacesSchema.parse(undefined)).toBeUndefined();
    expect(allNamespacesSchema.parse(true)).toBe(true);
  });
});
