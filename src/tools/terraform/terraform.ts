/**
 * Terraform Tools
 *
 * Wraps terraform commands (state list, show, plan, workspace) and returns
 * structured JSON. Uses terraform's JSON output mode where available and
 * parses line-based output for state list. Picks important attributes
 * per resource type to keep output compact.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, execJson, TIMEOUT } from "#exec";
import { err, ok } from "#response";

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
  .describe(
    "Binary to invoke (terraform or tofu). Defaults to $TF_BINARY, else terraform.",
  );

/** Register all Terraform tools on the MCP server. */
export function registerTerraformTools(server: McpServer) {
  // ── terraform state list ────────────────────────────────────────────
  server.registerTool(
    "tf_state_list",
    {
      title: "Terraform state list",
      description:
        "List resources in Terraform state. Returns structured resource addresses grouped by type.",
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
            module: z.string(),
          }),
        ),
        count: z.number(),
        byType: z.record(z.number()),
      },
    },
    async ({ cwd, binary }) => {
      const result = await exec(resolveTfBinary(binary), ["state", "list"], {
        cwd,
        timeout: 30_000,
      });

      if (result.exitCode !== 0) {
        return err(result.stderr, { resources: [], count: 0, byType: {} });
      }

      const resources = result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((address) => {
          const moduleMatch = address.match(/^(module\.[^.]+)\./);
          const module = moduleMatch?.[1] ?? "";
          const nonModule = module ? address.slice(module.length + 1) : address;
          const typeParts = nonModule.split(".");
          return {
            address,
            type: typeParts[0] ?? "",
            name: typeParts.slice(1).join("."),
            module,
          };
        });

      const byType: Record<string, number> = {};
      for (const r of resources) {
        byType[r.type] = (byType[r.type] ?? 0) + 1;
      }

      return ok({ resources, count: resources.length, byType });
    },
  );

  // ── terraform show (current state summary) ──────────────────────────
  server.registerTool(
    "tf_show",
    {
      title: "Terraform show",
      description:
        "Show current Terraform state as structured JSON. Returns resource summary with types and attributes.",
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
    },
    async ({ cwd, binary }) => {
      const result = await execJson<TfShowState>(
        resolveTfBinary(binary),
        ["show", "-json"],
        { cwd, timeout: TIMEOUT.TYPECHECK },
      );

      if (result.error) {
        return err(result.error, { resources: [], count: 0 });
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
  server.registerTool(
    "tf_plan_summary",
    {
      title: "Terraform plan summary",
      description:
        "Run terraform plan and return a structured summary of changes (add/change/destroy counts and affected resources).",
      inputSchema: {
        cwd: z.string().describe("Terraform project directory"),
        target: z.string().optional().describe("Target specific resource"),
        varFile: z.string().optional().describe("Var file to use"),
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
    async ({ cwd, target, varFile, binary }) => {
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

      for (const line of result.stdout.split("\n").filter(Boolean)) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === "planned_change" || msg.type === "resource_drift") {
            const c = msg.change ?? {};
            const action = Array.isArray(c.action)
              ? c.action.join(",")
              : (c.action ?? "unknown");
            changes.push({
              action,
              address: c.resource?.addr ?? "",
              type: c.resource?.resource_type ?? "",
            });
            if (action.includes("create")) add++;
            else if (action.includes("delete")) destroy++;
            else if (action.includes("update")) change++;
          }
        } catch {
          /* skip non-json lines */
        }
      }

      // JSON mode emits per-resource changes but not always a summary;
      // the human-readable summary ("X to add, Y to change, Z to destroy") appears on stderr

      for (const line of result.stderr.split("\n")) {
        const match = line.match(
          /(\d+) to add, (\d+) to change, (\d+) to destroy/,
        );
        if (match) {
          add = parseInt(match[1]!, 10);
          change = parseInt(match[2]!, 10);
          destroy = parseInt(match[3]!, 10);
        }
      }

      const noChanges = add === 0 && change === 0 && destroy === 0;
      return ok({ add, change, destroy, changes, noChanges });
    },
  );

  // ── terraform workspace ─────────────────────────────────────────────
  server.registerTool(
    "tf_workspaces",
    {
      title: "Terraform workspaces",
      description: "List Terraform workspaces with current workspace marked.",
      inputSchema: {
        cwd: z.string().describe("Terraform project directory"),
        binary: binarySchema,
      },
      outputSchema: {
        current: z.string(),
        workspaces: z.array(z.string()),
      },
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
