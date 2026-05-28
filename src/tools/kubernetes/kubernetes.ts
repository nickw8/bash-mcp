/**
 * Kubernetes Tools
 *
 * Wraps kubectl commands (get, logs, config) and returns structured JSON.
 * Uses kubectl's JSON output mode and summarizes verbose resource objects
 * into compact representations with only the fields agents need.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TIMEOUT, exec, execJson } from "#exec";
import { err, ok } from "#response";

/** Register all Kubernetes tools on the MCP server. */
export function registerKubernetesTools(server: McpServer) {
  // ── kubectl get ─────────────────────────────────────────────────────
  server.registerTool(
    "kube_get",
    {
      title: "Kubectl get resources",
      description:
        "Get Kubernetes resources as structured data. Wraps kubectl get -o json and returns a compact summary instead of raw JSON.",
      inputSchema: {
        resource: z
          .string()
          .describe("Resource type (e.g. pods, deployments, services, nodes)"),
        namespace: z
          .string()
          .optional()
          .describe("Namespace (omit for all-namespaces or cluster-scoped)"),
        allNamespaces: z.boolean().optional().describe("Search all namespaces"),
        selector: z
          .string()
          .optional()
          .describe("Label selector (e.g. 'app=nginx')"),
        name: z.string().optional().describe("Specific resource name"),
        context: z.string().optional().describe("Kubectl context to use"),
      },
      outputSchema: {
        items: z.array(
          z.object({
            name: z.string(),
            namespace: z.string(),
            status: z.string(),
            age: z.string(),
            labels: z.record(z.string()),
            extra: z.record(z.string()),
          }),
        ),
        count: z.number(),
        resource: z.string(),
      },
    },
    async ({ resource, namespace, allNamespaces, selector, name, context }) => {
      const args = ["get", resource, "-o", "json"];
      if (name) args.splice(2, 0, name);
      if (namespace) args.push("-n", namespace);
      if (allNamespaces) args.push("--all-namespaces");
      if (selector) args.push("-l", selector);
      if (context) args.push("--context", context);

      const result = await execJson<KubeList>("kubectl", args, {
        timeout: TIMEOUT.INFRA,
      });

      if (result.error) {
        return err(result.error, { items: [], count: 0, resource });
      }

      const rawItems =
        result.data?.kind === "List"
          ? (result.data.items ?? [])
          : [result.data];

      const items = rawItems
        .filter(Boolean)
        .map((item) => summarizeResource(item!));
      return ok({ items, count: items.length, resource });
    },
  );

  // ── kubectl logs ────────────────────────────────────────────────────
  server.registerTool(
    "kube_logs",
    {
      title: "Kubectl logs",
      description:
        "Get pod logs. Returns structured log lines with timestamps when available. " +
        "Use grep to filter lines by regex pattern (e.g. 'ERROR|WARN') instead of piping through shell commands.",
      inputSchema: {
        pod: z.string().describe("Pod name (or deployment/xxx)"),
        namespace: z
          .string()
          .optional()
          .default("default")
          .describe("Namespace"),
        container: z.string().optional().describe("Container name"),
        tail: z
          .number()
          .optional()
          .default(100)
          .describe("Number of lines (default 100)"),
        since: z.string().optional().describe("Duration like '1h', '30m'"),
        grep: z
          .string()
          .optional()
          .describe(
            "Regex pattern to filter log lines (e.g. 'ERROR|WARN', 'timeout'). Only matching lines are returned.",
          ),
        ignoreCase: z
          .boolean()
          .optional()
          .describe("Case-insensitive grep matching (default: false)"),
        context: z.string().optional().describe("Kubectl context"),
      },
      outputSchema: {
        lines: z.array(
          z.object({
            timestamp: z.string(),
            message: z.string(),
          }),
        ),
        count: z.number(),
        pod: z.string(),
      },
    },
    async ({ pod, namespace, container, tail, since, grep, ignoreCase, context }) => {
      const args = [
        "logs",
        pod,
        "-n",
        namespace ?? "default",
        "--timestamps",
        `--tail=${tail ?? 100}`,
      ];
      if (container) args.push("-c", container);
      if (since) args.push(`--since=${since}`);
      if (context) args.push("--context", context);

      const result = await exec("kubectl", args, { timeout: TIMEOUT.INFRA });

      if (result.exitCode !== 0) {
        return err(result.stderr, { lines: [], count: 0, pod });
      }

      let lines = result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const spaceIdx = line.indexOf(" ");
          if (spaceIdx > 0 && line[0]! >= "0" && line[0]! <= "9") {
            return {
              timestamp: line.slice(0, spaceIdx),
              message: line.slice(spaceIdx + 1),
            };
          }
          return { timestamp: "", message: line };
        });

      if (grep) {
        const re = new RegExp(grep, ignoreCase ? "i" : undefined);
        lines = lines.filter((l) => re.test(l.message));
      }

      return ok({ lines, count: lines.length, pod });
    },
  );

  // ── kubectl contexts ────────────────────────────────────────────────
  server.registerTool(
    "kube_contexts",
    {
      title: "Kubectl contexts",
      description:
        "List available kubectl contexts with current context marked.",
      inputSchema: {},
      outputSchema: {
        current: z.string(),
        contexts: z.array(
          z.object({
            name: z.string(),
            cluster: z.string(),
            namespace: z.string(),
            current: z.boolean(),
          }),
        ),
      },
    },
    async () => {
      const result = await exec("kubectl", [
        "config",
        "get-contexts",
        "--no-headers",
      ]);

      let current = "";
      const contexts = result.stdout
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

      return ok({ current, contexts });
    },
  );
}

// ── Types & helpers ───────────────────────────────────────────────────

/** Partial representation of a Kubernetes resource from kubectl JSON output. */
interface KubeResource {
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
  };
  status?: {
    phase?: string;
    conditions?: Array<{ type: string; status: string }>;
    readyReplicas?: number;
    replicas?: number;
    availableReplicas?: number;
    containerStatuses?: Array<{
      name: string;
      ready: boolean;
      restartCount: number;
    }>;
  };
  spec?: {
    replicas?: number;
    type?: string;
    clusterIP?: string;
    ports?: Array<{ port: number; targetPort: number; protocol: string }>;
  };
}

/** Kubernetes List response wrapper. */
interface KubeList {
  kind: string;
  items: KubeResource[];
}

/** Extract the most useful fields from a verbose Kubernetes resource object. */
function summarizeResource(item: KubeResource) {
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
