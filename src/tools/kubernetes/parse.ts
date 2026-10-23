/**
 * Pure Kubernetes output parsers.
 *
 * Extracted from kubernetes.ts so they can be fixture-tested without a live
 * cluster (`/arch:node`: pure functions + co-located tests reading from
 * `fixtures/`). No process spawning, no I/O — string in, structured out.
 */

/** Partial representation of a Kubernetes resource from kubectl JSON output. */
export interface KubeResource {
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
    deletionTimestamp?: string;
    labels?: Record<string, string>;
  };
  status?: {
    phase?: string;
    reason?: string;
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
      message?: string;
    }>;
    readyReplicas?: number;
    replicas?: number;
    availableReplicas?: number;
    unavailableReplicas?: number;
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
  };
  spec?: {
    replicas?: number;
    type?: string;
    clusterIP?: string;
    ports?: Array<{ port: number; targetPort: number; protocol: string }>;
    nodeName?: string;
  };
}

/** One entry of `status.containerStatuses` / `initContainerStatuses`. */
export interface ContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state?: ContainerState;
  lastState?: ContainerState;
}

/** A container state union as kubectl reports it (only one key is set). */
export interface ContainerState {
  waiting?: { reason?: string; message?: string };
  terminated?: {
    reason?: string;
    message?: string;
    exitCode?: number;
    signal?: number;
  };
  running?: { startedAt?: string };
}

/** Kubernetes List response wrapper. */
export interface KubeList {
  kind: string;
  items: KubeResource[];
}

/** Extract the most useful fields from a verbose Kubernetes resource object. */
export function summarizeResource(item: KubeResource) {
  const meta = item.metadata ?? {};
  const status = item.status ?? {};
  const spec = item.spec ?? {};

  const age = meta.creationTimestamp
    ? formatAge(new Date(meta.creationTimestamp))
    : "unknown";

  const extra: Record<string, string> = {};
  if (item.kind) extra.kind = item.kind;
  if (spec.replicas !== undefined)
    extra.replicas = `${status.readyReplicas ?? 0}/${spec.replicas}`;
  if (spec.type) extra.type = spec.type;
  if (spec.clusterIP) extra.clusterIP = spec.clusterIP;
  if (status.containerStatuses) {
    const restarts = status.containerStatuses.reduce(
      (s, c) => s + c.restartCount,
      0,
    );
    if (restarts > 0) extra.restarts = String(restarts);
  }

  return {
    name: meta.name ?? "",
    namespace: meta.namespace ?? "",
    status:
      item.kind === "Pod" || status.containerStatuses
        ? podStatus(item)
        : (status.phase ?? inferStatus(status.conditions)),
    age,
    labels: meta.labels ?? {},
    extra,
  };
}

/** `Signal:N` or `ExitCode:N` for a terminated state with no reason. */
function exitStatus(t: { exitCode?: number; signal?: number }): string {
  return t.signal ? `Signal:${t.signal}` : `ExitCode:${t.exitCode ?? 0}`;
}

/**
 * A pod's STATUS as `kubectl get pods` prints it (kubectl's `printPod`): a
 * failing init container, else the last app container's waiting or terminated
 * reason, else the pod reason or phase. A crash-looping pod's phase stays
 * `Running`; this reports `CrashLoopBackOff`.
 */
export function podStatus(pod: KubeResource): string {
  const status = pod.status ?? {};
  let reason = status.reason || status.phase || "Unknown";

  const inits = status.initContainerStatuses ?? [];
  let initializing = false;
  for (const [i, c] of inits.entries()) {
    const t = c.state?.terminated;
    const w = c.state?.waiting?.reason;
    if (t && t.exitCode === 0) continue;
    if (t) reason = `Init:${t.reason || exitStatus(t)}`;
    else if (w && w !== "PodInitializing") reason = `Init:${w}`;
    else reason = `Init:${i}/${inits.length}`;
    initializing = true;
    break;
  }

  if (!initializing) {
    let hasRunning = false;
    for (const c of [...(status.containerStatuses ?? [])].reverse()) {
      const t = c.state?.terminated;
      if (c.state?.waiting?.reason) reason = c.state.waiting.reason;
      else if (t) reason = t.reason || exitStatus(t);
      else if (c.ready && c.state?.running) hasRunning = true;
    }
    if (reason === "Completed" && hasRunning) reason = "Running";
  }

  if (pod.metadata?.deletionTimestamp)
    return status.reason === "NodeLost" ? "Unknown" : "Terminating";
  return reason;
}

/** Infer a simple status string from Kubernetes conditions when phase is absent. */
function inferStatus(
  conditions?: Array<{ type: string; status: string }>,
): string {
  if (!conditions?.length) return "Unknown";
  const ready = conditions.find(
    (c) => c.type === "Ready" || c.type === "Available",
  );
  return ready?.status === "True" ? "Ready" : "NotReady";
}

/** Format a creation timestamp into a compact age string (e.g. "3d", "2h"). */
function formatAge(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Parse `kubectl config get-contexts --no-headers` output. */
export function parseContexts(stdout: string): {
  current: string;
  contexts: Array<{
    name: string;
    cluster: string;
    namespace: string;
    current: boolean;
  }>;
} {
  let current = "";
  const contexts = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const isCurrent = line.startsWith("*");
      // get-contexts columns: NAME  CLUSTER  AUTHINFO  NAMESPACE
      const parts = line.replace(/^\*?\s+/, "").split(/\s+/);
      const name = parts[0] ?? "";
      const cluster = parts[1] ?? "";
      const ns = parts[3] ?? "default";
      if (isCurrent) current = name;
      return { name, cluster, namespace: ns, current: isCurrent };
    });
  return { current, contexts };
}
