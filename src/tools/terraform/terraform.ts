/**
 * Terraform Tools
 *
 * Wraps terraform commands (state list, show, plan, workspace) and returns
 * structured JSON. Uses terraform's JSON output mode where available and
 * parses line-based output for state list. Picks important attributes
 * per resource type to keep output compact.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, execJson, TIMEOUT } from "#exec";
import { err, ok, okList } from "#response";
import { defineTool } from "#tool";
import {
  parseBackend,
  parseModules,
  parseOutputs,
  parsePlanJson,
  parseProviders,
  parseValidate,
  planAction,
  tallyActions,
} from "./parse.js";

/**
 * Resolve which Terraform-compatible binary to invoke.
 *
 * Precedence: explicit `binary` param → `$TF_BINARY` env → "terraform".
 * The value is restricted to a known enum (never a free string) because it is
 * the executable passed to exec — a free string would be a command-exec vector.
 */
export function resolveTfBinary(
  binary?: "terraform" | "tofu",
): "terraform" | "tofu" {
  if (binary) return binary;
  return process.env.TF_BINARY === "tofu" ? "tofu" : "terraform";
}

/** Shared `binary` input fragment for tf_* tools. */
const binarySchema = z
  .enum(["terraform", "tofu"])
  .optional()
  .describe("terraform or tofu (default $TF_BINARY, else terraform)");

/** Register all Terraform tools on the MCP server. */
/** tf_state_list adds its byType rollup above this many resources. */
const BY_TYPE_MIN = 20;

export function registerTerraformTools(server: McpServer) {
  // ── terraform state list ────────────────────────────────────────────
  defineTool(
    server,
    "tf_state_list",
    {
      title: "Terraform state list",
      description:
        "List resources in Terraform state. Returns the resource addresses, plus a byType rollup " +
        `once there are more than ${BY_TYPE_MIN} (type, name, and module are readable from each address).`,
      equivalentCommands: ["terraform state list"],
      inputSchema: {
        cwd: z.string().describe("Terraform project directory"),
        binary: binarySchema,
      },
      outputSchema: {
        // Addresses only: `module.network.aws_subnet.public[0]` already carries
        // module, type, and name — repeating them per row tripled the payload
        // and never amortized (ADR-0009).
        resources: z.array(z.string()),
        byType: z.record(z.number()).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, binary }) => {
      const fmt = "bare";
      const result = await exec(resolveTfBinary(binary), ["state", "list"], {
        cwd,
        timeout: 30_000,
      });

      if (result.exitCode !== 0) {
        return err(result.stderr);
      }

      const resources = result.stdout.trim().split("\n").filter(Boolean);

      const byType: Record<string, number> = {};
      for (const address of resources) {
        const moduleMatch = address.match(/^(module\.[^.]+)\./);
        const module = moduleMatch?.[1] ?? "";
        const type = (
          module ? address.slice(module.length + 1) : address
        ).split(".")[0];
        if (type) byType[type] = (byType[type] ?? 0) + 1;
      }

      // A short list is its own rollup; past that, byType survives a budget
      // cut that drops most of the addresses.
      return okList(
        resources.length > BY_TYPE_MIN ? { resources, byType } : { resources },
        resources.map((address) => ({ address })),
        { count: resources.length, byType },
        fmt,
      );
    },
  );

  // ── terraform show (current state summary) ──────────────────────────
  defineTool(
    server,
    "tf_show",
    {
      title: "Terraform show",
      description:
        "Show current Terraform state as structured JSON. Returns resource summary with types and attributes.",
      equivalentCommands: ["terraform show"],
      inputSchema: {
        cwd: z.string().describe("Terraform project directory"),
        binary: binarySchema,
      },
      outputSchema: {
        resources: z.array(
          z.object({
            address: z.string(),
            type: z.string(),
            name: z.string(),
            provider: z.string(),
            attributes: z.record(z.string()),
          }),
        ),
        count: z.number(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, binary }) => {
      const result = await execJson<TfShowState>(
        resolveTfBinary(binary),
        ["show", "-json"],
        { cwd, timeout: TIMEOUT.TYPECHECK },
      );

      if (result.error) {
        return err(result.error, {}, result.detail);
      }

      const rawResources = result.data?.values?.root_module?.resources ?? [];
      const childResources = (
        result.data?.values?.root_module?.child_modules ?? []
      ).flatMap((m) => m.resources ?? []);

      const all = [...rawResources, ...childResources];
      const resources = all.map((r) => ({
        address: r.address ?? "",
        type: r.type ?? "",
        name: r.name ?? "",
        provider: r.provider_name ?? "",
        attributes: pickImportantAttributes(r.type ?? "", r.values ?? {}),
      }));

      return ok({ resources, count: resources.length });
    },
  );

  // ── terraform plan summary ──────────────────────────────────────────
  defineTool(
    server,
    "tf_plan_summary",
    {
      title: "Terraform plan summary",
      equivalentCommands: [
        "terraform plan -no-color",
        "terraform show -json <planfile>",
      ],
      description:
        "Run terraform plan and return a structured summary of changes (add/change/destroy counts and affected resources). Each action is create, update, delete, replace or read; a replace counts in add and destroy, as terraform's Plan line does.",
      inputSchema: {
        cwd: z.string().describe("Terraform project directory"),
        target: z.string().optional().describe("Target specific resource"),
        varFile: z.string().optional().describe("Var file to use"),
        planFile: z
          .string()
          .optional()
          .describe(
            "Path to a saved plan file (from `terraform plan -out`); summarized via `show -json` instead of re-running plan.",
          ),
        binary: binarySchema,
      },
      annotations: { readOnlyHint: true },
      outputSchema: {
        add: z.number(),
        change: z.number(),
        destroy: z.number(),
        changes: z.array(
          z.object({
            action: z.string(),
            address: z.string(),
            type: z.string(),
          }),
        ),
        noChanges: z.boolean(),
      },
    },
    async ({ cwd, target, varFile, planFile, binary }) => {
      // Saved-plan path: summarize an existing plan file without re-planning.
      if (planFile) {
        const showRes = await exec(
          resolveTfBinary(binary),
          ["show", "-json", planFile],
          { cwd, timeout: TIMEOUT.TYPECHECK },
        );
        try {
          return ok(parsePlanJson(JSON.parse(showRes.stdout)));
        } catch {
          return err(showRes.stderr || "terraform show -json failed", {
            noChanges: true,
          });
        }
      }

      const args = ["plan", "-json", "-no-color", "-input=false"];
      if (target) args.push(`-target=${target}`);
      if (varFile) args.push(`-var-file=${varFile}`);

      const result = await exec(resolveTfBinary(binary), args, {
        cwd,
        timeout: TIMEOUT.BUILD,
      });

      const changes: { action: string; address: string; type: string }[] = [];
      let add = 0,
        change = 0,
        destroy = 0;

      // `resource_drift` lines are changes made outside terraform, not planned
      // changes, so only `planned_change` is listed and counted. Terraform's
      // own `change_summary` totals win over the tally when present.
      let summary: { add?: number; change?: number; remove?: number } | null =
        null;
      for (const line of result.stdout.split("\n").filter(Boolean)) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === "change_summary") summary = msg.changes ?? {};
          if (msg.type !== "planned_change") continue;
          const c = msg.change ?? {};
          const action = planAction(c.action ?? []);
          if (action === "no-op") continue;
          changes.push({
            action,
            address: c.resource?.addr ?? "",
            type: c.resource?.resource_type ?? "",
          });
          const t = tallyActions(action);
          add += t.add;
          change += t.change;
          destroy += t.destroy;
        } catch {
          /* skip non-json lines */
        }
      }
      if (summary) {
        add = summary.add ?? 0;
        change = summary.change ?? 0;
        destroy = summary.remove ?? 0;
      }

      const noChanges = add === 0 && change === 0 && destroy === 0;
      return ok({ add, change, destroy, changes, noChanges });
    },
  );

  // ── terraform workspace ─────────────────────────────────────────────
  defineTool(
    server,
    "tf_workspaces",
    {
      title: "Terraform workspaces",
      description: "List Terraform workspaces with current workspace marked.",
      equivalentCommands: ["terraform workspace list"],
      inputSchema: {
        cwd: z.string().describe("Terraform project directory"),
        binary: binarySchema,
      },
      outputSchema: {
        current: z.string(),
        workspaces: z.array(z.string()),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, binary }) => {
      const result = await exec(
        resolveTfBinary(binary),
        ["workspace", "list"],
        {
          cwd,
        },
      );
      const lines = result.stdout.trim().split("\n").filter(Boolean);
      let current = "";
      const workspaces = lines.map((line) => {
        const isCurrent = line.startsWith("* ");
        const name = line.replace(/^[* ] +/, "").trim();
        if (isCurrent) current = name;
        return name;
      });

      return ok({ current, workspaces });
    },
  );

  // ── terraform output ────────────────────────────────────────────────
  defineTool(
    server,
    "tf_outputs",
    {
      title: "Terraform outputs",
      description:
        "List Terraform/OpenTofu outputs as [name, value] pairs; a sensitive output is redacted to [name] alone.",
      equivalentCommands: ["terraform output -json"],
      inputSchema: {
        cwd: z.string().describe("Terraform project directory"),
        binary: binarySchema,
      },
      outputSchema: {
        // [name, value] pairs, [name] for a redacted one: no per-row keys,
        // and `type` is readable off the value (ADR-0009). The text view
        // still shows the sensitive column.
        outputs: z.array(
          z.union([z.tuple([z.string(), z.string()]), z.tuple([z.string()])]),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, binary }) => {
      const fmt = "tsv";
      const res = await execJson<
        Record<string, { value?: unknown; type?: unknown; sensitive?: boolean }>
      >(resolveTfBinary(binary), ["output", "-json"], {
        cwd,
        timeout: TIMEOUT.INFRA,
      });
      if (res.error) return err(res.error, {}, res.detail);
      const outputs = parseOutputs(res.data ?? {});
      // Text view drops the verbose `type` column.
      const rows = outputs.map((o) => ({
        name: o.name,
        value: o.value ?? "",
        sensitive: o.sensitive,
      }));
      const slim = outputs.map((o) =>
        o.sensitive ? [o.name] : [o.name, o.value ?? ""],
      );
      return okList(
        { outputs: slim },
        rows,
        {
          count: outputs.length,
        },
        fmt,
      );
    },
  );

  // ── terraform providers (via version -json) ─────────────────────────
  defineTool(
    server,
    "tf_providers",
    {
      title: "Terraform providers",
      description:
        "List the Terraform/OpenTofu version and selected provider versions for the project.",
      equivalentCommands: ["terraform providers"],
      inputSchema: {
        cwd: z.string().describe("Terraform project directory"),
        binary: binarySchema,
      },
      outputSchema: {
        version: z.string(),
        providers: z.array(
          z.object({
            name: z.string(),
            source: z.string(),
            version: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, binary }) => {
      const res = await execJson<{
        terraform_version?: string;
        provider_selections?: Record<string, string>;
      }>(resolveTfBinary(binary), ["version", "-json"], {
        cwd,
        timeout: TIMEOUT.INFRA,
      });
      if (res.error) return err(res.error, {}, res.detail);
      return ok(parseProviders(res.data ?? {}));
    },
  );

  // ── terraform validate ──────────────────────────────────────────────
  defineTool(
    server,
    "tf_validate_summary",
    {
      title: "Terraform validate summary",
      description:
        "Validate the Terraform/OpenTofu config and return a compact pass/fail summary with diagnostics.",
      equivalentCommands: ["terraform validate"],
      inputSchema: {
        cwd: z.string().describe("Terraform project directory"),
        binary: binarySchema,
      },
      outputSchema: {
        valid: z.boolean(),
        errorCount: z.number(),
        warningCount: z.number(),
        diagnostics: z.array(
          z.object({
            severity: z.string(),
            summary: z.string(),
            file: z.string().optional(),
            line: z.number().optional(),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, binary }) => {
      // validate -json exits non-zero on invalid config but still prints JSON,
      // so parse stdout directly rather than using execJson's exit-code gate.
      const result = await exec(
        resolveTfBinary(binary),
        ["validate", "-json"],
        {
          cwd,
          timeout: TIMEOUT.TYPECHECK,
        },
      );
      try {
        return ok(parseValidate(JSON.parse(result.stdout)));
      } catch {
        return err(result.stderr || "terraform validate failed");
      }
    },
  );

  // ── terraform modules (from .terraform/modules/modules.json) ────────
  defineTool(
    server,
    "tf_modules_summary",
    {
      title: "Terraform modules summary",
      description:
        "List the modules used by an initialized Terraform/OpenTofu project (key, source, version). " +
        "Reads .terraform/modules/modules.json — run init first.",
      inputSchema: {
        cwd: z.string().describe("Terraform project directory"),
      },
      outputSchema: {
        modules: z.array(
          z.object({
            key: z.string(),
            source: z.string(),
            version: z.string(),
          }),
        ),
        count: z.number(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd }) => {
      try {
        const raw = readFileSync(
          join(cwd, ".terraform", "modules", "modules.json"),
          "utf8",
        );
        const modules = parseModules(JSON.parse(raw));
        return ok({ modules, count: modules.length });
      } catch {
        return err(
          "Could not read .terraform/modules/modules.json — run `terraform init` first.",
        );
      }
    },
  );

  // ── terraform backend (from .terraform/terraform.tfstate) ───────────
  defineTool(
    server,
    "tf_backend_info",
    {
      title: "Terraform backend info",
      description:
        "Report the configured backend type and config for an initialized project. " +
        "Reads .terraform/terraform.tfstate — run init first.",
      inputSchema: {
        cwd: z.string().describe("Terraform project directory"),
      },
      outputSchema: {
        type: z.string(),
        config: z.record(z.string()),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cwd }) => {
      try {
        const raw = readFileSync(
          join(cwd, ".terraform", "terraform.tfstate"),
          "utf8",
        );
        return ok(parseBackend(JSON.parse(raw)));
      } catch {
        return err(
          "Could not read .terraform/terraform.tfstate — run `terraform init` first.",
        );
      }
    },
  );
}

// ── Types ───────────────────────────────────────────────────────────

/** Partial terraform show -json output structure. */
interface TfShowState {
  values?: {
    root_module?: {
      resources?: TfResource[];
      child_modules?: Array<{ resources?: TfResource[] }>;
    };
  };
}

/** A single resource from terraform state JSON. */
interface TfResource {
  address?: string;
  type?: string;
  name?: string;
  provider_name?: string;
  values?: Record<string, unknown>;
}

/**
 * Pick the most useful attributes for a resource type.
 * Keeps output compact by only including fields agents commonly need
 * (e.g. id, instance_type, tags) instead of the full attribute blob.
 */
function pickImportantAttributes(
  type: string,
  values: Record<string, unknown>,
): Record<string, string> {
  const important: Record<string, string[]> = {
    aws_instance: [
      "id",
      "instance_type",
      "ami",
      "private_ip",
      "public_ip",
      "tags",
    ],
    aws_security_group: ["id", "name", "vpc_id"],
    aws_db_instance: [
      "id",
      "engine",
      "engine_version",
      "instance_class",
      "identifier",
    ],
    aws_eks_cluster: ["id", "name", "version", "status", "endpoint"],
    aws_elasticache_cluster: ["id", "engine", "node_type", "num_cache_nodes"],
    aws_s3_bucket: ["id", "bucket", "region"],
    aws_vpc: ["id", "cidr_block", "tags"],
    aws_subnet: ["id", "cidr_block", "vpc_id", "availability_zone"],
  };

  const keys = important[type] ?? ["id", "name", "tags"];
  const result: Record<string, string> = {};
  for (const key of keys) {
    if (values[key] !== undefined) {
      result[key] =
        typeof values[key] === "object"
          ? JSON.stringify(values[key])
          : String(values[key]);
    }
  }
  return result;
}
