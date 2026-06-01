/**
 * bash-mcp --doctor — preflight diagnostics
 *
 * Runs a set of client-only, non-blocking checks and returns a structured
 * report plus an exit code, so users can validate their setup before wiring
 * bash-mcp into Claude/Cursor. Invoked from src/index.ts when `--doctor` is
 * passed; otherwise the stdio MCP server starts as usual.
 *
 * Design (`/arch:node`): the report is a flat `Check[]`; `exitCodeFor` and
 * `formatReport` are pure (no `process.exit`, no IO) so they're unit-testable,
 * and `runDoctor` takes injectable deps so tests can drive each branch (old
 * Node, SDK import failure, missing CLIs) without touching the real
 * environment. No CLI framework — it's one flag (`/arch:guide`: don't overbuild).
 *
 * Probe reuse: the CLI-availability checks call the same `PROBES`/`runProbe`
 * that back `check_environment`, preserving the client-only/non-blocking guarantee.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMode, type SafetyMode } from "#safety";
import {
  PROBES,
  type Probe,
  runProbe,
  type ToolStatus,
} from "./tools/env/env.js";

/** Minimum Node major version (mirrors package.json engines `>=20`). */
const MIN_NODE_MAJOR = 20;
/** Recommended safety mode (aligns with the safe-defaults theme). */
const RECOMMENDED_MODE: SafetyMode = "readOnly";

/** One preflight check result. */
export interface Check {
  /** Short label, e.g. "Node.js" or "cli: kubectl". */
  name: string;
  /** Did the check pass? */
  ok: boolean;
  /** A failing critical check forces a non-zero exit; non-critical is advisory. */
  critical: boolean;
  /** Human-readable context (version, path, reason). */
  detail?: string;
}

export interface DoctorResult {
  checks: Check[];
  exitCode: number;
}

/** Injectable dependencies — defaults read the real environment. */
export interface DoctorDeps {
  nodeVersion?: string;
  probes?: Probe[];
  probe?: (p: Probe) => Promise<ToolStatus>;
  /** Resolve the dist entry path; checked for existence. */
  distEntry?: string;
  fileExists?: (path: string) => boolean;
  /** Attempt to load the MCP SDK; rejects if unavailable. */
  importSdk?: () => Promise<unknown>;
  mode?: SafetyMode;
  path?: string;
}

/** Resolve `<pkgRoot>/dist/index.js` from this module (works in bundle or src). */
function defaultDistEntry(): string {
  // In the built bundle this file is dist/index.js; under tsx/vitest it's
  // src/doctor.ts. In both cases the package root is two levels up.
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  return join(root, "dist", "index.js");
}

function defaultImportSdk(): Promise<unknown> {
  return import("@modelcontextprotocol/sdk/server/mcp.js");
}

/** True if any critical check failed. */
export function exitCodeFor(checks: Check[]): number {
  return checks.some((c) => c.critical && !c.ok) ? 1 : 0;
}

/** Render the report as printable text (✓ pass, ✗ critical fail, • advisory). */
export function formatReport(checks: Check[]): string {
  const lines = ["bash-mcp doctor", ""];
  for (const c of checks) {
    const mark = c.ok ? "✓" : c.critical ? "✗" : "•";
    lines.push(`  ${mark} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  const failed = checks.filter((c) => c.critical && !c.ok).length;
  lines.push(
    "",
    failed
      ? `FAIL: ${failed} critical check(s) failed.`
      : "OK: all critical checks passed.",
  );
  return lines.join("\n");
}

/** Run all preflight checks and compute the exit code. */
export async function runDoctor(deps: DoctorDeps = {}): Promise<DoctorResult> {
  const {
    nodeVersion = process.versions.node,
    probes = PROBES,
    probe = runProbe,
    distEntry = defaultDistEntry(),
    fileExists = existsSync,
    importSdk = defaultImportSdk,
    mode = resolveMode(),
    path = process.env.PATH ?? "",
  } = deps;

  const checks: Check[] = [];

  // Node version (critical) — too old → cryptic SDK/runtime failures.
  const major = Number.parseInt(nodeVersion.split(".")[0] ?? "", 10);
  checks.push({
    name: "Node.js",
    ok: Number.isFinite(major) && major >= MIN_NODE_MAJOR,
    critical: true,
    detail: `v${nodeVersion} (requires >=${MIN_NODE_MAJOR})`,
  });

  // dist entry (advisory) — absent under `tsx` dev, which is fine.
  const builtOk = fileExists(distEntry);
  checks.push({
    name: "dist entry",
    ok: builtOk,
    critical: false,
    detail: builtOk
      ? distEntry
      : `${distEntry} (not built — run \`npm run build\`; expected when running from source)`,
  });

  // MCP SDK loadable (critical) — the server cannot start without it.
  let sdkOk = false;
  let sdkDetail = "@modelcontextprotocol/sdk loadable";
  try {
    await importSdk();
    sdkOk = true;
  } catch (e) {
    sdkDetail = `import failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  checks.push({
    name: "MCP SDK",
    ok: sdkOk,
    critical: true,
    detail: sdkDetail,
  });

  // PATH (advisory) — CLI probes resolve binaries from it.
  checks.push({
    name: "PATH",
    ok: path.length > 0,
    critical: false,
    detail: path || "(empty)",
  });

  // CLI availability (advisory) — informational, same probes as check_environment.
  const statuses = await Promise.all(probes.map(probe));
  for (const s of statuses) {
    checks.push({
      name: `cli: ${s.name}`,
      ok: s.installed,
      critical: false,
      detail: s.installed ? (s.version ?? "installed") : "not found",
    });
  }

  // Resolved safety mode (advisory) — surface it with the recommendation.
  checks.push({
    name: "BASH_MCP_MODE",
    ok: true,
    critical: false,
    detail:
      mode === RECOMMENDED_MODE
        ? `${mode} (recommended)`
        : `${mode} (recommended: ${RECOMMENDED_MODE})`,
  });

  return { checks, exitCode: exitCodeFor(checks) };
}
