/**
 * Kube Args
 *
 * The kube scope module: the inputs the kubectl and helm groups both take —
 * which cluster (`context`) and which namespace(s) (`namespace`,
 * `allNamespaces`) — declared once, with the argv each one becomes.
 *
 * The context flag is the same input — "which cluster?" — spelled differently
 * by each CLI: kubectl takes `--context`, helm takes `--kube-context`. Both
 * were written out by hand at each call site, in four different shapes, which
 * is how a group ends up passing the wrong flag name. Namespace scope had the
 * same problem: four call sites, four ways to build "all namespaces or this
 * one", two of which passed both flags at once.
 *
 * argocd is deliberately absent. It accepts `--kube-context` too, but only
 * under `--core`; without that it talks to the Argo API server, where a kube
 * context means nothing. Exposing one there would be a lie.
 */

import { z } from "zod";

/**
 * The `namespace` input, defaulting to `default` like the CLIs themselves do.
 *
 * Zod fills the default in before the handler runs, so the parameter is always
 * a string: a `namespace ?? "default"` in the body is dead code, and eight of
 * them were. A tool that means "all namespaces when omitted" (helm_list) wants
 * a plain optional string instead, not this.
 */
export const namespaceSchema = z
  .string()
  .default("default")
  .describe("Namespace");

/** `--context <ctx>` for kubectl, or nothing when no context was asked for. */
export function kubectlContext(context?: string): string[] {
  return context ? ["--context", context] : [];
}

/** `--kube-context <ctx>` for helm, or nothing when no context was asked for. */
export function helmContext(context?: string): string[] {
  return context ? ["--kube-context", context] : [];
}

/** The `context` input. One description, whichever CLI spells the flag. */
export const contextSchema = z.string().optional().describe("Kube context");

/** The `allNamespaces` input; when set it wins over `namespace`. */
export const allNamespacesSchema = z
  .boolean()
  .optional()
  .describe("Search all namespaces (overrides namespace)");

/**
 * The namespace scope argv, which kubectl and helm spell identically:
 * `--all-namespaces` when asked for, else `-n <ns>`, else nothing. Never both —
 * `allNamespaces` wins, so a caller's `namespace` default cannot leak in.
 */
export function namespaceScope(
  namespace?: string,
  allNamespaces?: boolean,
): string[] {
  if (allNamespaces) return ["--all-namespaces"];
  return namespace ? ["-n", namespace] : [];
}
