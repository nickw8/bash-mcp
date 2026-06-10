/**
 * liquibase_validate tool — structured changelog validation.
 *
 * Wraps `liquibase validate` and parses its output into a pass/fail result with
 * per-changeset errors. A clean run collapses to `{ valid: true, errorCount: 0 }`.
 *
 * A validation *failure* (duplicate ids, checksum drift, …) is a real result, not
 * a tool error: the command ran and told us the changelog is invalid, so it is
 * returned as `ok({ valid: false, errors })` like dotnet_test reports failing
 * tests. Only a run that could not validate at all — missing binary, bad
 * connection, auth failure — is surfaced as an error via `classifyError`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyError } from "#error";
import { exec, TIMEOUT } from "#exec";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import { liquibaseArgs, liquibaseCommonInput } from "./args.js";
import { parseValidate } from "./parsers/validate.js";

/** Register the liquibase_validate tool. */
export function registerLiquibaseValidateTool(server: McpServer) {
  defineTool(
    server,
    "liquibase_validate",
    {
      title: "Validate changelog (structured)",
      description:
        "Validate a Liquibase changelog and return a structured pass/fail result with " +
        "per-changeset errors (duplicate ids, checksum drift). Much more compact than raw " +
        "output. liquibase is on PATH — no mise/wrapper needed.",
      annotations: { readOnlyHint: true },
      equivalentCommands: ["liquibase validate"],
      inputSchema: {
        ...liquibaseCommonInput,
      },
      outputSchema: {
        valid: z.boolean(),
        errorCount: z.number(),
        errors: z.array(
          z.object({
            changesetId: z.string().optional(),
            file: z.string().optional(),
            message: z.string(),
          }),
        ),
      },
    },
    async ({ cwd, ...opts }) => {
      const result = await exec("liquibase", liquibaseArgs("validate", opts), {
        cwd,
        timeout: TIMEOUT.BUILD,
      });
      const output = `${result.stdout}\n${result.stderr}`;
      const parsed = parseValidate(output);

      // A non-zero exit with no identified changeset errors means liquibase
      // could not validate (missing binary, connection/auth failure) rather than
      // an invalid changelog — surface it as a classified tool error.
      if (result.exitCode !== 0 && parsed.errorCount === 0) {
        const e = classifyError(
          { ...result, stderr: result.stderr.trim() || result.stdout.trim() },
          "liquibase",
        );
        return err(e.message, { ...parsed }, e);
      }

      return ok({ ...parsed });
    },
  );
}
