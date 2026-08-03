/**
 * Kubernetes Tools
 *
 * Wraps kubectl commands (get, logs, config) and returns structured JSON.
 * Uses kubectl's JSON output mode and summarizes verbose resource objects
 * into compact representations with only the fields agents need.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, execJson, TIMEOUT } from "#exec";
import type { ListFormat } from "#format";
import { kubectlContext, namespaceSchema } from "#kube-args";
import { applyBudget, budgetSchema, parseJsonishOutput } from "#parsers";
import { err, ok, okList } from "#response";
import { defineTool } from "#tool";
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
        includeLabels: z
          .boolean()
          .optional()
          .describe(
            "Include each resource's labels (default false — labels are verbose and mostly hashes; use selector to filter or jq to read specific ones)",
          ),
        format: z
          .enum(["json", "tsv", "columnar", "bare"])
          .optional()
          .describe("Output format for the item list (default: tsv)"),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            "Limit the text view to these columns, e.g. ['name','status','restarts'] (text view only)",
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
      includeLabels,
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
      args.push(...kubectlContext(context));

      if (jqFilter) {
        const kubectlResult = await exec("kubectl", args, {
          timeout: TIMEOUT.INFRA,
        });
        if (kubectlResult.exitCode !== 0) {
          return err(kubectlResult.stderr || kubectlResult.stdout);
        }
        const jqResult = await exec("jq", [jqFilter], {
          stdin: kubectlResult.stdout,
        });
        if (jqResult.exitCode !== 0) {
          return err(jqResult.stderr);
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
        return err(result.error, { resource }, result.detail);
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
      // Payload shaping (ADR-0009): the client is billed for structuredContent, so
      // anything repeated on every item is hoisted to the top level, `extra` is
      // flattened away, and labels (mostly template hashes) are opt-in.
      const uniform = <T>(values: T[]) => {
        const set = new Set(values);
        return set.size === 1 ? values[0] : undefined;
      };
      const kind = uniform(items.map((it) => it.extra.kind));
      const namespace_ = uniform(items.map((it) => it.namespace));
      const slim = items.map(({ extra, labels, ...it }) => {
        const { kind: itemKind, ...rest } = extra;
        return {
          name: it.name,
          ...(namespace_ === undefined ? { namespace: it.namespace } : {}),
          status: it.status,
          age: it.age,
          ...(kind === undefined && itemKind ? { kind: itemKind } : {}),
          ...rest,
          ...(includeLabels ? { labels } : {}),
        };
      });
      const structured = {
        items: slim,
        count: items.length,
        resource,
        ...(kind ? { kind } : {}),
        ...(namespace_ ? { namespace: namespace_ } : {}),
        ...(hasBudget ? { total, truncated } : {}),
      };
      return okList(
        structured,
        slim,
        {
          count: items.length,
          resource,
          kind,
          namespace: namespace_,
          total,
          truncated,
        },
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
      equivalentCommands: ["kubectl logs <pod> -n <ns>"],
      inputSchema: {
        pod: z.string().describe("Pod name (or deployment/xxx)"),
        namespace: namespaceSchema,
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
        namespace,
        "--timestamps",
        `--tail=${tail ?? 100}`,
      ];
      if (container) args.push("-c", container);
      if (since) args.push(`--since=${since}`);
      args.push(...kubectlContext(context));

      const result = await exec("kubectl", args, { timeout: TIMEOUT.INFRA });

      if (result.exitCode !== 0) {
        return err(result.stderr, { pod });
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
      equivalentCommands: ["kubectl config get-contexts"],
      inputSchema: {
        format: z
          .enum(["json", "tsv", "columnar", "bare"])
          .optional()
          .describe("Output format (default: tsv)"),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            "Limit the text view to these columns (text block only, not the returned payload)",
          ),
      },
      outputSchema: {
        current: z.string(),
        // The current context is named once at the top level, and `cluster` is
        // carried only when it differs from the context name (ADR-0009).
        contexts: z.array(
          z.object({
            name: z.string(),
            namespace: z.string(),
            cluster: z.string().optional(),
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
      const contexts = parsed.contexts.map(({ name, cluster, namespace }) => ({
        name,
        namespace,
        ...(cluster && cluster !== name ? { cluster } : {}),
      }));
      return okList(
        { current: parsed.current, contexts },
        parsed.contexts,
        { current: parsed.current },
        fmt,
        { fields },
      );
    },
  );

  // ── Higher-level diagnostics ────────────────────────────────────────
  registerKubeDiagnosticTools(server);
}
