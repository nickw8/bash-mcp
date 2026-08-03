/**
 * Kube Context Flag
 *
 * The same input — "which cluster?" — spelled differently by each CLI: kubectl
 * takes `--context`, helm takes `--kube-context`. Both were written out by hand
 * at each call site, in four different shapes, which is how a group ends up
 * passing the wrong flag name.
 *
 * argocd is deliberately absent. It accepts `--kube-context` too, but only
 * under `--core`; without that it talks to the Argo API server, where a kube
 * context means nothing. Exposing one there would be a lie.
 */

/** `--context <ctx>` for kubectl, or nothing when no context was asked for. */
export function kubectlContext(context?: string): string[] {
  return context ? ["--context", context] : [];
}

/** `--kube-context <ctx>` for helm, or nothing when no context was asked for. */
export function helmContext(context?: string): string[] {
  return context ? ["--kube-context", context] : [];
}
