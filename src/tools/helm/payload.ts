/**
 * Helm CLI Payload
 *
 * The subset of `helm … -o json` this group reads, one declaration per command.
 * `helm status` used to be described twice — HelmStatus in helm.ts for the
 * helm_status tool, HelmStatusInfo in triage.ts for helm_release_triage — same
 * JSON, different field sets, so a field one file learned about stayed unknown
 * to the other.
 *
 * Every field is optional: helm's output is not a contract this repo controls,
 * and a parser that assumes otherwise breaks on a version bump.
 */

/** A single release from `helm list -o json`. */
export interface HelmRelease {
  name?: string;
  namespace?: string;
  revision?: string;
  status?: string;
  chart?: string;
  app_version?: string;
  updated?: string;
}

/** A release's current state from `helm status -o json`. */
export interface HelmStatus {
  name?: string;
  namespace?: string;
  version?: number;
  info?: {
    status?: string;
    description?: string;
    last_deployed?: string;
    notes?: string;
  };
}

/** One revision from `helm history -o json`. */
export interface HelmHistoryEntry {
  revision?: number;
  updated?: string;
  status?: string;
  chart?: string;
  app_version?: string;
  description?: string;
}
