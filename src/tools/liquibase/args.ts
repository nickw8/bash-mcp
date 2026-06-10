/**
 * Shared input schema and argument builder for the Liquibase tools.
 *
 * Every liquibase tool accepts the same connection/scoping options (a defaults
 * file, an optional changelog override, and label/context filters). `liquibaseArgs`
 * assembles them into the CLI form `liquibase [global flags] <command> [scoped flags]`,
 * with `--defaults-file` / `--changelog-file` as global flags (they must precede the
 * command verb) and `--labels` / `--contexts` scoped after it.
 */

import { z } from "zod";

/** Zod raw shape spread into each liquibase tool's `inputSchema`. */
export const liquibaseCommonInput = {
  cwd: z
    .string()
    .optional()
    .describe(
      "Directory to run liquibase in (where the defaults file / changelog live).",
    ),
  defaultsFile: z
    .string()
    .optional()
    .describe(
      "Path to the Liquibase defaults file (--defaults-file), e.g. db-dev.properties. " +
        "Usually carries the JDBC URL, credentials, and changelog path.",
    ),
  changelogFile: z
    .string()
    .optional()
    .describe(
      "Changelog path (--changelog-file); usually set in the defaults file instead.",
    ),
  labels: z
    .string()
    .optional()
    .describe("Label expression to filter changesets (--labels)."),
  contexts: z
    .string()
    .optional()
    .describe("Context expression to filter changesets (--contexts)."),
  extraArgs: z
    .array(z.string())
    .optional()
    .describe("Additional raw arguments appended to the liquibase invocation."),
};

/** Connection/scoping options accepted by every liquibase tool. */
export interface LiquibaseOptions {
  defaultsFile?: string;
  changelogFile?: string;
  labels?: string;
  contexts?: string;
  extraArgs?: string[];
}

/**
 * Build the full liquibase argument list for a command.
 *
 * Global flags (`--defaults-file`, `--changelog-file`) precede the command verb;
 * scoping flags (`--labels`, `--contexts`) and `extraArgs` follow it.
 */
export function liquibaseArgs(
  command: string | string[],
  opts: LiquibaseOptions,
): string[] {
  const args: string[] = [];
  if (opts.defaultsFile) args.push(`--defaults-file=${opts.defaultsFile}`);
  if (opts.changelogFile) args.push(`--changelog-file=${opts.changelogFile}`);
  args.push(...(Array.isArray(command) ? command : [command]));
  if (opts.labels) args.push(`--labels=${opts.labels}`);
  if (opts.contexts) args.push(`--contexts=${opts.contexts}`);
  if (opts.extraArgs) args.push(...opts.extraArgs);
  return args;
}
