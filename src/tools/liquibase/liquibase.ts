/**
 * Liquibase tool group — structured output for the liquibase CLI.
 *
 * Registers liquibase_validate, liquibase_update_sql, and liquibase_status, which
 * parse Liquibase's text output (banner, changeset markers, tracking rows) into
 * compact, token-efficient JSON. All three are read-only — none apply changes.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerLiquibaseStatusTool } from "./status.js";
import { registerLiquibaseUpdateSqlTool } from "./update-sql.js";
import { registerLiquibaseValidateTool } from "./validate.js";

/** Register all Liquibase tools on the given MCP server. */
export function registerLiquibaseTools(server: McpServer) {
  registerLiquibaseValidateTool(server);
  registerLiquibaseUpdateSqlTool(server);
  registerLiquibaseStatusTool(server);
}
