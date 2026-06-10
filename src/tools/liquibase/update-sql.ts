/**
 * liquibase_update_sql tool — structured preview of the migration script.
 *
 * Wraps `liquibase updateSQL` (which renders, but does not apply, the SQL for all
 * pending changesets) and parses it into per-changeset summaries: id/author/file,
 * contexts/labels, line count, first statement, and a SQL-Server batch lint.
 *
 * The full rendered SQL is large, so it is omitted by default — pass `includeRaw`
 * to attach each changeset's `sql`, or `changesetId` to return just one changeset's
 * SQL. `updateSQL` exits 0 on success, so any non-zero exit is a run failure
 * (missing binary, bad connection) surfaced via `classifyError`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyError } from "#error";
import { exec, TIMEOUT } from "#exec";
import { err, ok } from "#response";
import { defineTool } from "#tool";
import { applyBudget, budgetSchema } from "../../parsers/schemas.js";
import { liquibaseArgs, liquibaseCommonInput } from "./args.js";
import { type Changeset, parseUpdateSql } from "./parsers/update-sql.js";

const batchLintSchema = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
});

const changesetSchema = z.object({
  id: z.string(),
  author: z.string(),
  file: z.string(),
  contexts: z.string().optional(),
  labels: z.string().optional(),
  sqlLineCount: z.number(),
  firstStatement: z.string().optional(),
  batchLint: batchLintSchema.optional(),
  sql: z.string().optional(),
});

/** Drop the heavy `sql` field unless the caller asked for raw output. */
function summarize(changeset: Changeset, includeRaw: boolean): Changeset {
  if (includeRaw) return changeset;
  const { sql: _sql, ...rest } = changeset;
  return rest as Changeset;
}

/** Register the liquibase_update_sql tool. */
export function registerLiquibaseUpdateSqlTool(server: McpServer) {
  defineTool(
    server,
    "liquibase_update_sql",
    {
      title: "Preview migration SQL (structured)",
      description:
        "Render the SQL Liquibase would run for pending changesets (updateSQL) as structured " +
        "per-changeset summaries with a SQL-Server batch lint. Does NOT apply changes. SQL bodies " +
        "are omitted unless includeRaw or changesetId is set. liquibase is on PATH — no mise/wrapper needed.",
      annotations: { readOnlyHint: true },
      equivalentCommands: ["liquibase updateSQL"],
      inputSchema: {
        ...liquibaseCommonInput,
        changesetId: z
          .string()
          .optional()
          .describe(
            "Return only this changeset's full rendered SQL (matches the changeset id).",
          ),
        batchLint: z
          .boolean()
          .optional()
          .describe(
            "Lint each changeset for the SQL-Server 'routine DDL must lead its GO-batch' rule (default true).",
          ),
        ...budgetSchema,
      },
      outputSchema: {
        changesetCount: z.number(),
        changesets: z.array(changesetSchema),
        total: z.number().optional(),
        truncated: z.boolean().optional(),
      },
    },
    async ({
      cwd,
      changesetId,
      batchLint,
      detailLevel,
      maxItems,
      includeRaw,
      ...opts
    }) => {
      const result = await exec("liquibase", liquibaseArgs("updateSQL", opts), {
        cwd,
        timeout: TIMEOUT.BUILD,
      });
      const output = `${result.stdout}\n${result.stderr}`;

      if (result.exitCode !== 0) {
        const e = classifyError(
          { ...result, stderr: result.stderr.trim() || result.stdout.trim() },
          "liquibase",
        );
        return err(e.message, { changesetCount: 0, changesets: [] }, e);
      }

      const parsed = parseUpdateSql(output, { batchLint });

      // Single-changeset lookup: return that changeset's full SQL.
      if (changesetId) {
        const match = parsed.changesets.find((c) => c.id === changesetId);
        if (!match) {
          return err(
            `Changeset '${changesetId}' not found among ${parsed.changesetCount} pending changesets`,
            { changesetCount: 0, changesets: [] },
            {
              kind: "not_found",
              message: `Changeset '${changesetId}' not found`,
              command: "liquibase",
              suggestion:
                "Check the id with liquibase_status or liquibase_update_sql.",
            },
          );
        }
        return ok({ changesetCount: 1, changesets: [match] });
      }

      // Summary view: drop SQL bodies unless includeRaw, then apply the budget.
      const summaries = parsed.changesets.map((c) =>
        summarize(c, !!includeRaw),
      );
      const hasBudget = detailLevel !== undefined || maxItems !== undefined;
      const { items, truncated, total } = applyBudget(summaries, {
        detailLevel,
        maxItems,
      });

      return ok({
        changesetCount: parsed.changesetCount,
        changesets: items,
        ...(hasBudget ? { total, truncated } : {}),
      });
    },
  );
}
