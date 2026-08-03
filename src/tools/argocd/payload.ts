/**
 * ArgoCD CLI Payload
 *
 * The subset of `argocd app … -o json` this group reads. `argocd app get`
 * returns one shape, but it used to be described twice — ArgoApp in argocd.ts
 * for the listing tools, ArgoAppHealth in health.ts for the triage — and the
 * two had drifted in both directions: only ArgoApp knew about `spec.source`,
 * only ArgoAppHealth knew about `health.message` and `operationState.phase`.
 *
 * Every field is optional: argocd's output is not a contract this repo
 * controls, and a parser that assumes otherwise breaks on a version bump.
 */

/** An application from `argocd app list` / `argocd app get`. */
export interface ArgoApp {
  metadata?: { name?: string };
  spec?: {
    project?: string;
    source?: { repoURL?: string; path?: string; targetRevision?: string };
    destination?: { server?: string; namespace?: string };
  };
  status?: {
    sync?: { status?: string; revision?: string };
    health?: { status?: string; message?: string };
    operationState?: { message?: string; phase?: string };
    resources?: Array<{
      kind?: string;
      name?: string;
      namespace?: string;
      status?: string;
      health?: { status?: string; message?: string };
    }>;
    conditions?: Array<{ type?: string; message?: string }>;
  };
}
