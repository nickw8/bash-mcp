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
    labels?: Record<string, string>;
  };
  status?: {
    phase?: string;
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
    containerStatuses?: Array<{
      name: string;
      ready: boolean;
      restartCount: number;
      state?: ContainerState;
      lastState?: ContainerState;
    }>;
  };
  spec?: {
    replicas?: number;
    type?: string;
    clusterIP?: string;
    ports?: Array<{ port: number; targetPort: number; protocol: string }>;
    nodeName?: string;
  };
}

/** A container state union as kubectl reports it (only one key is set). */
export interface ContainerState {
  waiting?: { reason?: string; message?: string };
  terminated?: { reason?: string; message?: string; exitCode?: number };
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
    status: status.phase ?? inferStatus(status.conditions),
    age,
    labels: meta.labels ?? {},
    extra,
  };
}

/** Infer a simple status string from Kubernetes conditions when phase is absent. */
export function inferStatus(
  conditions?: Array<{ type: string; status: string }>,
): string {
  if (!conditions?.length) return "Unknown";
  const ready = conditions.find(
    (c) => c.type === "Ready" || c.type === "Available",
  );
  return ready?.status === "True" ? "Ready" : "NotReady";
}

/** Format a creation timestamp into a compact age string (e.g. "3d", "2h"). */
export function formatAge(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Parse `kubectl logs --timestamps` output into timestamped lines. */
export function parseLogLines(
  stdout: string,
): Array<{ timestamp: string; message: string }> {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const spaceIdx = line.indexOf(" ");
      const first = line[0];
      if (spaceIdx > 0 && first !== undefined && first >= "0" && first <= "9") {
        return {
          timestamp: line.slice(0, spaceIdx),
          message: line.slice(spaceIdx + 1),
        };
      }
      return { timestamp: "", message: line };
    });
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
