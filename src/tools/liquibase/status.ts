/**
 * liquibase_status tool — structured pending-changeset report.
 *
 * Wraps `liquibase status --verbose` and parses it into `{ upToDate, pendingCount,
 * pending[] }`. `status` exits 0 whether or not changesets are pending, so any
 * non-zero exit is an actual run failure (missing binary, bad connection) and is
 * surfaced via `classifyError` — never misreported as "up to date".
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyError } from "#error";
import { exec, TIMEOUT } from "#exec";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import { liquibaseArgs, liquibaseCommonInput } from "./args.js";
import { parseStatus } from "./parsers/status.js";

/** Register the liquibase_status tool. */
export function registerLiquibaseStatusTool(server: McpServer) {
  defineTool(
    server,
    "liquibase_status",
    {
      title: "Pending changesets (structured)",
      description:
        "List Liquibase changesets not yet applied to the target database, as structured " +
        "JSON. Reports up-to-date vs a pending list. liquibase is on PATH — no mise/wrapper needed.",
      annotations: { readOnlyHint: true },
      equivalentCommands: ["liquibase status --verbose"],
      inputSchema: {
        ...liquibaseCommonInput,
      },
      outputSchema: {
        upToDate: z.boolean(),
        pendingCount: z.number(),
        pending: z.array(
          z.object({
            id: z.string(),
            author: z.string(),
            file: z.string(),
          }),
        ),
      },
    },
    async ({ cwd, ...opts }) => {
      const result = await exec(
        "liquibase",
        liquibaseArgs(["status", "--verbose"], opts),
        { cwd, timeout: TIMEOUT.BUILD },
      );
      const output = `${result.stdout}\n${result.stderr}`;
      const parsed = parseStatus(output);

      if (result.exitCode !== 0) {
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
