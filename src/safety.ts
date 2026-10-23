/**
 * Safety profiles for the `run`/`batch` escape-hatch tools.
 *
 * `BASH_MCP_MODE` controls blocking of mutating commands. **Default is
 * readOnly**: when unset (or "readOnly"), write-classified `run`/`batch`
 * commands are blocked. Set "off" (or "dangerous") to disable enforcement —
 * `run`/`batch` then behave with no gating.
 *
 * Classification is a best-effort const table (`/arch:node` const dispatch),
 * applied through shells (`sh -c`), wrappers (`sudo`, `xargs`, `env`) and
 * `find -exec`/`-delete` so the command that actually runs is the one judged —
 * not a security boundary — it's a guardrail an operator opts into. Unknown
 * commands are allowed (fail-open), and sub-subcommands that are sometimes
 * read (e.g. `kubectl rollout status`, `terraform state list`) are NOT treated
 * as writes to avoid false positives.
 */

import { basename } from "node:path";

export type SafetyMode = "off" | "readOnly" | "confirmWrites" | "dangerous";

/** Resolve BASH_MCP_MODE; anything unrecognized (incl. unset) → "readOnly". */
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
    case "off":
      return "off";
    default:
      return "readOnly";
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

/**
 * The mutating subcommand in `args`, if any. Global flags may precede it
 * (`kubectl -n prod delete`, `git -C repo push`): a bare token right after a
 * flag without `=` might be that flag's value, so it is skipped unless it is
 * itself a mutating subcommand. The first token that can only be the
 * subcommand ends the scan.
 */
function mutatingSubcommand(sub: string[], args: string[]): string | undefined {
  let maybeFlagValue = false;
  for (const arg of args) {
    if (arg.startsWith("-")) {
      maybeFlagValue = !arg.includes("=");
      continue;
    }
    if (sub.includes(arg)) return arg;
    if (!maybeFlagValue) return undefined;
    maybeFlagValue = false;
  }
  return undefined;
}

/** Shells whose `-c` script is classified command by command. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** Binaries that run their arguments as a command (`sudo rm`, `xargs rm`). */
const WRAPPERS = new Set([
  "sudo",
  "doas",
  "env",
  "eval",
  "xargs",
  "nohup",
  "nice",
  "time",
  "timeout",
  "command",
  "exec",
  "watch",
]);

/** Leading shell words that precede a command without being one. */
const SHELL_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
  "!",
  "{",
]);

/**
 * The first write in a `sh -c` script. The script is split on the operators
 * that start a new command (`;`, `&&`, `||`, `|`, newlines, subshells, command
 * substitution) and each command is classified like a top-level one.
 *
 * ponytail: a word split, not a shell parser — quoting that hides an operator
 * splits too eagerly (safe direction), and `> file` redirects are not treated
 * as writes. Swap in a real tokenizer if the gate needs to hold against an
 * adversary rather than an agent's honest mistake.
 */
function scriptWrite(script: string): string | undefined {
  for (const segment of script.split(/\$\(|[;&|\n`()]/)) {
    const words = segment
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/^['"]+|['"]+$/g, ""))
      .filter(Boolean);
    let i = 0;
    while (
      i < words.length &&
      (SHELL_KEYWORDS.has(words[i] as string) ||
        /^\w+=/.test(words[i] as string))
    ) {
      i++;
    }
    if (i >= words.length) continue;
    const found = writeOf(words[i] as string, words.slice(i + 1));
    if (found) return found;
  }
  return undefined;
}

/**
 * The write a command performs, as a label (`kubectl delete`, `rm`), if any.
 *
 * Shells, wrappers and `find -exec` run another command, so that command is
 * what gets classified: without this, `sh -c 'kubectl delete …'` and
 * `xargs rm` passed readOnly as an unknown `sh`/`xargs`. A wrapper's own
 * flags and operands are not told apart from the command, so every bare
 * operand is tried as one — `xargs grep rm` is a false positive, which is the
 * safe way round.
 */
function writeOf(command: string, args: string[]): string | undefined {
  const binary = basename(command);
  if (SHELLS.has(binary)) {
    const i = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    return i >= 0 ? scriptWrite(args[i + 1] ?? "") : undefined;
  }
  if (WRAPPERS.has(binary)) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] as string;
      if (arg.startsWith("-") || arg.includes("=")) continue;
      // `eval 'rm x'` and `watch 'kubectl delete …'` take a script, not argv.
      const found = /\s/.test(arg)
        ? scriptWrite(arg)
        : writeOf(arg, args.slice(i + 1));
      if (found) return found;
    }
    return undefined;
  }
  if (binary === "find") {
    if (args.includes("-delete")) return "find -delete";
    for (let i = 0; i < args.length; i++) {
      if (!/^-(exec|execdir|ok|okdir)$/.test(args[i] as string)) continue;
      const found = writeOf(args[i + 1] ?? "", args.slice(i + 2));
      if (found) return found;
    }
    return undefined;
  }
  const rule = WRITE_RULES[binary];
  if (!rule) return undefined;
  if (rule.always) return binary;
  const sub = rule.sub && mutatingSubcommand(rule.sub, args);
  return sub ? `${binary} ${sub}` : undefined;
}

/** Classify a command as read/write/unknown for safety gating. */
export function classifyCommand(
  command: string,
  args: string[],
): "read" | "write" | "unknown" {
  if (writeOf(command, args)) return "write";
  return WRITE_RULES[basename(command)] ? "read" : "unknown";
}

/** Decide whether a command may run under the given mode. */
export function checkCommandAllowed(
  command: string,
  args: string[],
  mode: SafetyMode = resolveMode(),
): { allowed: boolean; reason?: string } {
  if (mode === "off" || mode === "dangerous") return { allowed: true };
  const label = writeOf(command, args);
  if (label) {
    return {
      allowed: false,
      reason: `Blocked mutating command '${label}': BASH_MCP_MODE=${mode}. Set BASH_MCP_MODE=off to allow writes.`,
    };
  }
  return { allowed: true };
}
