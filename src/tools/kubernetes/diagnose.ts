/**
 * Pure pod-failure classification.
 *
 * Collapses the "why is this pod unhealthy?" reasoning into one structured
 * answer so an agent doesn't have to call get → describe → logs and reason
 * across raw output. Pattern: const rule table (`/arch:node`) mapping
 * container/pod state to { reason, evidence, suggestion }.
 *
 * Pure and fixture-tested — input is a parsed pod object, output is the
 * diagnostic shape. Never throws on malformed input.
 */

import type { KubeResource } from "./parse.js";

/** The shared diagnostic answer shape returned by all kube diagnostics. */
export interface Diagnosis {
  status: string;
  likelyCauses: string[];
  suggestedNextCommands: string[];
  evidence: string[];
}

/** A Kubernetes event from `kubectl get events -o json`. */
export interface KubeEvent {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
  involvedObject?: { kind?: string; name?: string };
}

interface FailureRule {
  /** Short machine reason (also used as the overall status when primary). */
  reason: string;
  /** Returns an evidence string if the rule matches, else null. */
  detect: (pod: KubeResource) => string | null;
  /** Actionable remediation hint. */
  suggestion: string;
}

function containers(pod: KubeResource) {
  return pod.status?.containerStatuses ?? [];
}

function totalRestarts(pod: KubeResource): number {
  return containers(pod).reduce((sum, c) => sum + (c.restartCount ?? 0), 0);
}

/** Evidence if any container is waiting with one of the given reasons. */
function waitingReason(pod: KubeResource, reasons: string[]): string | null {
  for (const c of containers(pod)) {
    const r = c.state?.waiting?.reason;
    if (r && reasons.includes(r)) {
      const msg = c.state?.waiting?.message;
      return `container "${c.name}" is ${r}${msg ? `: ${msg}` : ""}`;
    }
  }
  return null;
}

/** Evidence if any container's (last) terminated state matches the reasons. */
function terminatedReason(pod: KubeResource, reasons: string[]): string | null {
  for (const c of containers(pod)) {
    const t = c.lastState?.terminated ?? c.state?.terminated;
    if (t?.reason && reasons.includes(t.reason)) {
      const exit = t.exitCode !== undefined ? ` (exit ${t.exitCode})` : "";
      return `container "${c.name}" was ${t.reason}${exit}`;
    }
  }
  return null;
}

/** Evidence if a Pending pod cannot be scheduled. */
function unschedulable(pod: KubeResource): string | null {
  if (pod.status?.phase !== "Pending") return null;
  const cond = pod.status?.conditions?.find(
    (c) => c.type === "PodScheduled" && c.status === "False",
  );
  if (cond)
    return `pod is unschedulable${cond.message ? `: ${cond.message}` : ""}`;
  return null;
}

/** Failure rules, most-specific first. */
const RULES: FailureRule[] = [
  {
    reason: "ImagePullBackOff",
    detect: (pod) => waitingReason(pod, ["ImagePullBackOff", "ErrImagePull"]),
    suggestion:
      "Verify the image name/tag exists and the registry credentials (imagePullSecrets) are correct.",
  },
  {
    reason: "CrashLoopBackOff",
    detect: (pod) => waitingReason(pod, ["CrashLoopBackOff"]),
    suggestion:
      "Inspect container logs for the crash cause; check the entrypoint/command and liveness probe.",
  },
  {
    reason: "OOMKilled",
    detect: (pod) => terminatedReason(pod, ["OOMKilled"]),
    suggestion:
      "Raise the container memory limit or reduce its memory usage; OOMKilled means it hit the cgroup limit.",
  },
  {
    reason: "Unschedulable",
    detect: unschedulable,
    suggestion:
      "Check node capacity, taints/tolerations, and nodeSelector/affinity constraints.",
  },
];

/**
 * Diagnose a single pod from its parsed JSON. Returns the standard diagnostic
 * shape; status is the primary failure reason, else the pod phase.
 */
export function diagnosePod(pod: KubeResource): Diagnosis {
  const name = pod.metadata?.name ?? "";
  const ns = pod.metadata?.namespace ?? "default";
  const likelyCauses: string[] = [];
  const evidence: string[] = [];
  let primaryReason: string | undefined;

  for (const rule of RULES) {
    const ev = rule.detect(pod);
    if (ev) {
      if (!primaryReason) primaryReason = rule.reason;
      likelyCauses.push(rule.suggestion);
      evidence.push(ev);
    }
  }

  const restarts = totalRestarts(pod);
  if (!primaryReason && restarts >= 3) {
    primaryReason = "Restarting";
    likelyCauses.push(
      "Container has restarted repeatedly; inspect logs for a recurring error.",
    );
    evidence.push(`total restarts: ${restarts}`);
  }

  const status = primaryReason ?? pod.status?.phase ?? "Unknown";

  const suggestedNextCommands: string[] = [];
  if (name) {
    suggestedNextCommands.push(`kube_logs pod=${name} namespace=${ns}`);
    suggestedNextCommands.push(`kube_events_summary namespace=${ns}`);
  }

  return { status, likelyCauses, suggestedNextCommands, evidence };
}

/** Summarize `kubectl get events` into the warning-focused diagnostic shape. */
export function summarizeEvents(events: KubeEvent[]): Diagnosis {
  const warnings = events
    .filter((e) => e.type === "Warning")
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

  const evidence = warnings.map((e) => {
    const obj = e.involvedObject
      ? `${e.involvedObject.kind ?? "?"}/${e.involvedObject.name ?? "?"}`
      : "cluster";
    const times = e.count && e.count > 1 ? ` x${e.count}` : "";
    return `${e.reason ?? "Warning"}${times} on ${obj}: ${e.message ?? ""}`.trim();
  });

  return {
    status: warnings.length ? "Warning" : "OK",
    likelyCauses: warnings.length
      ? [
          "Warning events point at scheduling, image-pull, or crash issues on the named objects.",
        ]
      : [],
    suggestedNextCommands: warnings.length
      ? ["kube_pod_failure_summary", "kube_diagnose_pod"]
      : [],
    evidence,
  };
}

/** Diagnose a Deployment's rollout health from its replica counts/conditions. */
export function diagnoseDeployment(dep: KubeResource): Diagnosis {
  const desired = dep.spec?.replicas ?? 0;
  const ready = dep.status?.readyReplicas ?? 0;
  const available = dep.status?.availableReplicas ?? 0;
  const ns = dep.metadata?.namespace ?? "default";

  const evidence: string[] = [`${ready}/${desired} replicas ready`];
  const likelyCauses: string[] = [];
  let status = "Available";

  if (ready < desired || available < desired) {
    status = "Degraded";
    likelyCauses.push(
      "Not all replicas are available; inspect the failing pods.",
    );
  }

  const badCond = dep.status?.conditions?.find(
    (c) =>
      (c.type === "Available" && c.status === "False") ||
      (c.type === "Progressing" && c.status === "False"),
  );
  if (badCond) {
    status = "Degraded";
    const reason = badCond.reason ? ` (${badCond.reason})` : "";
    const msg = badCond.message ? `: ${badCond.message}` : "";
    evidence.push(`${badCond.type}=False${reason}${msg}`);
  }

  return {
    status,
    likelyCauses,
    suggestedNextCommands:
      status === "Degraded" ? [`kube_pod_failure_summary namespace=${ns}`] : [],
    evidence,
  };
}
