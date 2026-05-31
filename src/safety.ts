/**
 * Safety profiles for the `run`/`batch` escape-hatch tools.
 *
 * `BASH_MCP_MODE` opts into blocking mutating commands. **Default is OFF**: when
 * unset (or "off"/"dangerous"), `run`/`batch` behave exactly as before — no
 * enforcement. Only `readOnly`/`confirmWrites` block write-classified commands.
 *
 * Classification is a best-effort const table (`/arch:node` const dispatch),
 * not a security boundary — it's a guardrail an operator opts into. Unknown
 * commands are allowed (fail-open), and sub-subcommands that are sometimes
 * read (e.g. `kubectl rollout status`, `terraform state list`) are NOT treated
 * as writes to avoid false positives.
 */

export type SafetyMode = "off" | "readOnly" | "confirmWrites" | "dangerous";

/** Resolve BASH_MCP_MODE; anything unrecognized (incl. unset) → "off". */
export function resolveMode(
  raw: string | undefined = process.env.BASH_MCP_MODE,
): SafetyMode {
  switch ((raw ?? "").toLowerCase()) {
    case "readonly":
      return "readOnly";
    case "confirmwrites":
      return "confirmWrites";
    case "dangerous":
      return "dangerous";
    default:
      return "off";
  }
}

/** Write classification per binary: mutating first-subcommands, or always-write. */
const WRITE_RULES: Record<string, { sub?: string[]; always?: boolean }> = {
  kubectl: {
    sub: [
      "apply",
      "create",
      "delete",
      "patch",
      "edit",
      "replace",
      "scale",
      "annotate",
      "label",
      "set",
      "drain",
      "cordon",
      "uncordon",
      "taint",
      "expose",
      "autoscale",
    ],
  },
  helm: { sub: ["install", "upgrade", "uninstall", "delete", "rollback"] },
  terraform: { sub: ["apply", "destroy", "import", "taint", "untaint"] },
  tofu: { sub: ["apply", "destroy", "import", "taint", "untaint"] },
  argocd: { sub: ["sync", "delete", "set", "rollback", "create"] },
  git: {
    sub: [
      "push",
      "commit",
      "reset",
      "rebase",
      "merge",
      "cherry-pick",
      "revert",
      "clean",
      "checkout",
      "restore",
      "stash",
      "am",
    ],
  },
  rm: { always: true },
  mv: { always: true },
  dd: { always: true },
  mkfs: { always: true },
  shred: { always: true },
  truncate: { always: true },
};

/** Classify a command as read/write/unknown for safety gating. */
export function classifyCommand(
  command: string,
  args: string[],
): "read" | "write" | "unknown" {
  const rule = WRITE_RULES[command];
  if (!rule) return "unknown";
  if (rule.always) return "write";
  const sub = args[0];
  if (sub && rule.sub?.includes(sub)) return "write";
  return "read";
}

/** Decide whether a command may run under the given mode. */
export function checkCommandAllowed(
  command: string,
  args: string[],
  mode: SafetyMode = resolveMode(),
): { allowed: boolean; reason?: string } {
  if (mode === "off" || mode === "dangerous") return { allowed: true };
  if (classifyCommand(command, args) === "write") {
    const label = `${command} ${args[0] ?? ""}`.trim();
    return {
      allowed: false,
      reason: `Blocked mutating command '${label}': BASH_MCP_MODE=${mode}. Unset BASH_MCP_MODE to allow writes.`,
    };
  }
  return { allowed: true };
}
