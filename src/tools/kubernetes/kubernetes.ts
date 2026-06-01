/**
 * Kubernetes Tools
 *
 * Wraps kubectl commands (get, logs, config) and returns structured JSON.
 * Uses kubectl's JSON output mode and summarizes verbose resource objects
 * into compact representations with only the fields agents need.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, execJson, execWithStdin, TIMEOUT } from "#exec";
import type { ListFormat } from "#format";
import { err, ok, okList } from "#response";
import { defineTool } from "#tool";
import { parseJsonishOutput } from "../../parsers/json-output.js";
import { applyBudget, budgetSchema } from "../../parsers/schemas.js";
import { registerKubeDiagnosticTools } from "./diagnostics.js";
import {
  type KubeList,
  parseContexts,
  parseLogLines,
  summarizeResource,
} from "./parse.js";

/** Register all Kubernetes tools on the MCP server. */
export function registerKubernetesTools(server: McpServer) {
  // ── kubectl get ─────────────────────────────────────────────────────
  defineTool(
    server,
    "kube_get",
    {
      title: "Kubectl get resources",
      equivalentCommands: ["kubectl get <resource> -o json"],
      description:
        "Get Kubernetes resources as structured data. Wraps kubectl get -o json and returns a compact summary by default. " +
        "Use the jq param to extract specific fields from the raw JSON (e.g. '.spec.template.spec.containers[].env') instead of the summary.",
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
        jq: z
          .string()
          .optional()
          .describe(
            "jq filter applied to raw kubectl JSON. Skips the default summary and returns the jq result instead. " +
              "Example: '.spec.template.spec.containers[].env'",
          ),
        format: z
          .enum(["json", "tsv", "columnar", "bare"])
          .optional()
          .describe("Output format for the item list (default: tsv)"),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            "Limit the text view to these columns, e.g. ['name','status','restarts'] (structuredContent keeps all)",
          ),
        ...budgetSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      resource,
      namespace,
      allNamespaces,
      selector,
      name,
      context,
      jq: jqFilter,
      format,
      fields,
      detailLevel,
      maxItems,
    }) => {
      const fmt = (format ?? "tsv") as ListFormat;
      const args = ["get", resource, "-o", "json"];
      if (name) args.splice(2, 0, name);
      if (namespace) args.push("-n", namespace);
      if (allNamespaces) args.push("--all-namespaces");
      if (selector) args.push("-l", selector);
      if (context) args.push("--context", context);

      if (jqFilter) {
        const kubectlResult = await exec("kubectl", args, {
          timeout: TIMEOUT.INFRA,
        });
        if (kubectlResult.exitCode !== 0) {
          return err(kubectlResult.stderr || kubectlResult.stdout, {
            result: null,
          });
        }
        const jqResult = await execWithStdin(
          "jq",
          [jqFilter],
          kubectlResult.stdout,
        );
        if (jqResult.exitCode !== 0) {
          return err(jqResult.stderr, { result: null });
        }
        const parsed = parseJsonishOutput(jqResult.stdout);
        switch (parsed.kind) {
          case "single":
            return ok({ result: parsed.value });
          case "multi":
            return ok({ result: parsed.values });
          case "raw":
            return ok({ result: parsed.text });
        }
      }

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

      const allItems = rawItems
        .filter((item): item is NonNullable<typeof item> => item != null)
        .map((item) => summarizeResource(item));

      const hasBudget = detailLevel !== undefined || maxItems !== undefined;
      const { items, truncated, total } = applyBudget(allItems, {
        detailLevel,
        maxItems,
      });
      const structured = hasBudget
        ? { items, count: items.length, resource, total, truncated }
        : { items, count: items.length, resource };
      // Flatten labels/extra for the text view: extra fields (replicas, restarts,
      // type, …) become top-level columns; verbose labels stay in structuredContent.
      const rows = items.map((it) => ({
        name: it.name,
        namespace: it.namespace,
        status: it.status,
        age: it.age,
        ...it.extra,
      }));
      return okList(
        structured,
        rows,
        { count: items.length, resource, total, truncated },
        fmt,
        { fields },
      );
    },
  );

  // ── kubectl logs ────────────────────────────────────────────────────
  defineTool(
    server,
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
        ...budgetSchema,
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
        total: z.number().optional(),
        truncated: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      pod,
      namespace,
      container,
      tail,
      since,
      grep,
      ignoreCase,
      context,
      detailLevel,
      maxItems,
    }) => {
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

      let lines = parseLogLines(result.stdout);

      if (grep) {
        const re = new RegExp(grep, ignoreCase ? "i" : undefined);
        lines = lines.filter((l) => re.test(l.message));
      }

      const hasBudget = detailLevel !== undefined || maxItems !== undefined;
      const {
        items: capped,
        truncated,
        total,
      } = applyBudget(lines, {
        detailLevel,
        maxItems,
      });
      return ok(
        hasBudget
          ? { lines: capped, count: capped.length, pod, total, truncated }
          : { lines: capped, count: capped.length, pod },
      );
    },
  );

  // ── kubectl contexts ────────────────────────────────────────────────
  defineTool(
    server,
    "kube_contexts",
    {
      title: "Kubectl contexts",
      description:
        "List available kubectl contexts with current context marked.",
      inputSchema: {
        format: z
          .enum(["json", "tsv", "columnar", "bare"])
          .optional()
          .describe("Output format (default: tsv)"),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            "Limit the text view to these columns (structuredContent keeps all)",
          ),
      },
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
      annotations: { readOnlyHint: true },
    },
    async ({ format, fields }) => {
      const fmt = (format ?? "tsv") as ListFormat;
      const result = await exec("kubectl", [
        "config",
        "get-contexts",
        "--no-headers",
      ]);

      const parsed = parseContexts(result.stdout);
      return okList(parsed, parsed.contexts, { current: parsed.current }, fmt, {
        fields,
      });
    },
  );

  // ── Higher-level diagnostics ────────────────────────────────────────
  registerKubeDiagnosticTools(server);
}
