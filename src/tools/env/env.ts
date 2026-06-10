/**
 * Environment / Capability Discovery
 *
 * `check_environment` lets an agent discover which CLIs are available (and
 * their versions) before attempting tool calls, instead of failing one command
 * at a time. Pattern: const probe table (`/arch:node` const dispatch).
 *
 * Probes are deliberately **client-only and non-blocking**: each runs a local
 * `--version`/`--client` command with a short timeout, in parallel. We do NOT
 * make server or auth calls (e.g. `argocd login`, `kubectl get`) that could
 * hang or prompt — only kubectl's current-context is read, which is local.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "#exec";
import { ok } from "#response";
import { defineTool } from "#tool";

/** A single client-only capability probe. */
export interface Probe {
  /** Logical name reported to the caller. */
  name: string;
  /** Executable to run. */
  binary: string;
  /** Client-only args that print a version without contacting a server. */
  versionArgs: string[];
}

/** Short per-probe timeout — probes run in parallel and must not hang. */
const PROBE_TIMEOUT = 5_000;

/** The capability probe table. Keep version args client-only/non-blocking. */
export const PROBES: Probe[] = [
  { name: "node", binary: "node", versionArgs: ["--version"] },
  { name: "git", binary: "git", versionArgs: ["--version"] },
  { name: "kubectl", binary: "kubectl", versionArgs: ["version", "--client"] },
  { name: "terraform", binary: "terraform", versionArgs: ["version"] },
  { name: "tofu", binary: "tofu", versionArgs: ["version"] },
  { name: "helm", binary: "helm", versionArgs: ["version", "--short"] },
  { name: "argocd", binary: "argocd", versionArgs: ["version", "--client"] },
  { name: "jq", binary: "jq", versionArgs: ["--version"] },
  { name: "yq", binary: "yq", versionArgs: ["--version"] },
  { name: "rg", binary: "rg", versionArgs: ["--version"] },
  { name: "dotnet", binary: "dotnet", versionArgs: ["--version"] },
  { name: "liquibase", binary: "liquibase", versionArgs: ["--version"] },
  { name: "ruff", binary: "ruff", versionArgs: ["--version"] },
  { name: "mypy", binary: "mypy", versionArgs: ["--version"] },
  { name: "pytest", binary: "pytest", versionArgs: ["--version"] },
];

/** Extract the first semver-like token from CLI version output. */
export function parseVersion(output: string): string | undefined {
  const match = output.match(/\d+\.\d+(?:\.\d+)?/);
  return match ? match[0] : undefined;
}

/** One tool's capability status. */
export interface ToolStatus {
  name: string;
  installed: boolean;
  version?: string;
  /** Extra context, e.g. kubectl's current context. */
  detail?: string;
}

/**
 * Run a single probe; never throws. Missing binary → installed:false.
 * Exported so the `--doctor` CLI (src/doctor.ts) reuses the exact same
 * client-only, non-blocking probe as `check_environment`.
 */
export async function runProbe(p: Probe): Promise<ToolStatus> {
  const res = await exec(p.binary, p.versionArgs, { timeout: PROBE_TIMEOUT });
  if (res.errorCode === "ENOENT") {
    return { name: p.name, installed: false };
  }
  const version = parseVersion(`${res.stdout}\n${res.stderr}`);
  return { name: p.name, installed: true, version };
}

/** Register the env tools on the MCP server. */
export function registerEnvTools(server: McpServer) {
  defineTool(
    server,
    "check_environment",
    {
      title: "Check environment",
      description:
        "Report which CLIs are installed (and their versions) so you can pick the right tool before calling it. " +
        "Probes are client-only and non-blocking — no server/auth calls. Includes kubectl's current context when available.",
      inputSchema: {},
      outputSchema: {
        tools: z.array(
          z.object({
            name: z.string(),
            installed: z.boolean(),
            version: z.string().optional(),
            detail: z.string().optional(),
          }),
        ),
        installedCount: z.number(),
        total: z.number(),
      },
      annotations: { readOnlyHint: true },
    },
    async () => {
      const tools = await Promise.all(PROBES.map(runProbe));

      // Enrich kubectl with its current context (local read, non-blocking).
      const kube = tools.find((t) => t.name === "kubectl");
      if (kube?.installed) {
        const ctx = await exec("kubectl", ["config", "current-context"], {
          timeout: PROBE_TIMEOUT,
        });
        const name = ctx.stdout.trim();
        if (ctx.exitCode === 0 && name) kube.detail = name;
      }

      const installedCount = tools.filter((t) => t.installed).length;
      return ok({ tools, installedCount, total: tools.length });
    },
  );
}
