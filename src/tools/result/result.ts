/**
 * Result retrieval
 *
 * `result_get` reads back a payload the response budget (`#budget`) trimmed.
 * When a response carries `retained.id`, the whole payload is in the
 * session-scoped result store (`#result-store`). This tool returns one slice of
 * it, so the agent can page through a long list without running the command
 * again. A stored result is a snapshot from `capturedAt`; run the original tool
 * again for current data.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { err, ok } from "#response";
import { resultStore, sessionOf } from "#result-store";
import { defineTool } from "#tool";

const DEFAULT_LIMIT = 100;

function walk(root: unknown, path: string): { found: boolean; value: unknown } {
  let node = root;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object" || !Object.hasOwn(node, part)) {
      return { found: false, value: undefined };
    }
    node = (node as Record<string, unknown>)[part];
  }
  return { found: true, value: node };
}

export function registerResultTools(server: McpServer): void {
  defineTool(
    server,
    "result_get",
    {
      title: "Get Retained Result",
      description:
        "Page through a result the response budget trimmed. Pass the retained.id from that response; path selects a field (dotted, e.g. files.0), offset/limit slice an array. Snapshot of the original call, kept for retained.expiresInSec.",
      inputSchema: {
        id: z
          .string()
          .optional()
          .describe("retained.id from a trimmed response"),
        path: z
          .string()
          .optional()
          .describe("Dotted path into the payload; omit for the whole payload"),
        offset: z.number().int().min(0).optional().describe("Default 0"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(`Default ${DEFAULT_LIMIT}`),
      },
      outputSchema: {
        id: z.string(),
        tool: z.string(),
        capturedAt: z.string(),
        path: z.string(),
        total: z.number().optional(),
        offset: z.number(),
        value: z.unknown(),
      },
      required: ["id"],
      retain: false,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, path = "", offset = 0, limit = DEFAULT_LIMIT }, extra) => {
      const key = id as string;
      const lookup = resultStore.get(sessionOf(extra), key);
      if (!lookup.found) {
        const message =
          lookup.reason === "expired"
            ? `result ${key} expired; run the original tool again`
            : `no result ${key} in this session; ids are per-session and expire`;
        return err(
          message,
          { id: key, path },
          {
            kind: "not_found",
            message,
            command: "result_get",
            suggestion: "Run the original tool again for a fresh result.",
          },
        );
      }
      const { tool, payload, capturedAt } = lookup.result;
      const at =
        path === "" ? { found: true, value: payload } : walk(payload, path);
      if (!at.found) {
        const message = `result ${key} has no field ${path}`;
        return err(
          message,
          { id: key, tool, path },
          {
            kind: "invalid_input",
            message,
            command: "result_get",
            suggestion: `Top-level fields: ${Object.keys(payload).join(", ")}.`,
          },
        );
      }
      const base = {
        id: key,
        tool,
        capturedAt: new Date(capturedAt).toISOString(),
        path,
        offset,
      };
      if (!Array.isArray(at.value)) {
        return ok({ ...base, value: at.value }, `${tool} ${path || "result"}`);
      }
      const slice = at.value.slice(offset, offset + limit);
      const end = offset + slice.length;
      return ok(
        { ...base, total: at.value.length, value: slice },
        `${tool} ${path || "result"} ${offset}-${end} of ${at.value.length}${
          end < at.value.length ? `; next offset ${end}` : ""
        }`,
      );
    },
  );
}
