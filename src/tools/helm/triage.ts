/**
 * Pure Helm release triage.
 *
 * Combines `helm status` + `helm history` into a single health answer so an
 * agent doesn't have to call both and reason across them. Pure and
 * fixture-tested; never throws on missing fields.
 */

import type { Triage } from "#parsers";

/** One entry from `helm history -o json`. */
export interface HelmHistoryEntry {
  revision?: number;
  updated?: string;
  status?: string;
  chart?: string;
  app_version?: string;
  description?: string;
}

/** Current status subset from `helm status -o json`. */
export interface HelmStatusInfo {
  name?: string;
  namespace?: string;
  version?: number;
  info?: { status?: string; description?: string };
}

/**
 * Triage a release from its current status and revision history.
 * Returns the shared triage envelope plus helm-specific revision fields.
 */
export function triageRelease(
  current: HelmStatusInfo,
  history: HelmHistoryEntry[],
): Triage & { healthy: boolean; revision: number; revisions: number } {
  const status = current.info?.status ?? "unknown";
  const healthy = status === "deployed";
  const ns = current.namespace ?? "default";
  const likelyCauses: string[] = [];
  const suggestedNextCommands: string[] = [];

  if (status.startsWith("pending")) {
    likelyCauses.push(
      "Release is stuck in a pending state — a previous install/upgrade did not complete (possibly interrupted).",
    );
    suggestedNextCommands.push(`kube_pod_failure_summary namespace=${ns}`);
  } else if (status === "failed") {
    likelyCauses.push(
      "The last release operation failed; inspect the failed revision and the underlying workloads.",
    );
    if (current.info?.description) {
      likelyCauses.push(current.info.description);
    }
    suggestedNextCommands.push(`kube_pod_failure_summary namespace=${ns}`);
  } else if (status === "superseded") {
    likelyCauses.push("This revision was superseded by a newer one.");
  }

  const sorted = [...history].sort(
    (a, b) => (b.revision ?? 0) - (a.revision ?? 0),
  );
  const evidence = sorted
    .slice(0, 5)
    .map((h) =>
      `rev ${h.revision ?? "?"} ${h.status ?? "?"}${
        h.description ? `: ${h.description}` : ""
      }`.trim(),
    );

  const failedCount = history.filter((h) => h.status === "failed").length;
  if (failedCount > 0 && healthy) {
    likelyCauses.push(
      `${failedCount} earlier revision(s) failed before the current healthy deploy.`,
    );
  }

  return {
    status,
    healthy,
    revision: current.version ?? 0,
    revisions: history.length,
    likelyCauses,
    suggestedNextCommands,
    evidence,
  };
}
