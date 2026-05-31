/**
 * defineTool — cross-cutting wrapper around server.registerTool.
 *
 * Pattern: Decorator (`/arch:guide` Boundary pain). Instead of editing every
 * handler, `defineTool` wraps the handler once to:
 *   - time the call and emit exactly one wide event (in `finally`),
 *   - derive `outcome` from `result.isError` (not just thrown errors), and
 *   - convert a thrown error into a uniform `err(...)` response.
 *
 * The tool `config` (including `annotations` and `_meta`, which the SDK
 * destructures) is forwarded to `registerTool` untouched. Wide events log only
 * `argCount` and `cwd` — never raw arg values — so secrets in `run`/`batch`
 * commands are not leaked.
 *
 * Generics mirror `McpServer.registerTool` so handler arg types are still
 * inferred from the tool's `inputSchema` at each call site.
 */

import type {
  McpServer,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import { logger as defaultLogger, type Logger, type WideEvent } from "#logger";
import { err } from "#response";

/** Tool config object, matching the shape registerTool accepts. */
interface ToolConfig<
  InputArgs extends ZodRawShape,
  OutputArgs extends ZodRawShape,
> {
  title?: string;
  description?: string;
  inputSchema?: InputArgs;
  outputSchema?: OutputArgs;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
}

/** Minimal shape we read off a handler result for outcome classification. */
interface ResultShape {
  isError?: boolean;
  content?: { type: string; text: string }[];
  structuredContent?: { error?: { kind?: string } };
}

/**
 * Register a tool with wide-event logging and uniform error handling.
 *
 * @param log - injectable logger (defaults to the process-wide stderr logger).
 */
export function defineTool<
  InputArgs extends ZodRawShape,
  OutputArgs extends ZodRawShape,
>(
  server: McpServer,
  name: string,
  config: ToolConfig<InputArgs, OutputArgs>,
  handler: ToolCallback<InputArgs>,
  log: Logger = defaultLogger,
): void {
  const call = handler as (...a: unknown[]) => unknown;

  const wrapped = async (...callArgs: unknown[]) => {
    const args = callArgs[0];
    const start = performance.now();
    let outcome: WideEvent["outcome"] = "success";
    let errorKind: string | undefined;

    try {
      const result = (await call(...callArgs)) as ResultShape;
      if (result?.isError) {
        outcome = "error";
        errorKind = result.structuredContent?.error?.kind;
      }
      return result;
    } catch (e) {
      outcome = "error";
      errorKind = "command_failed";
      const message = e instanceof Error ? e.message : String(e);
      return err(
        message,
        {},
        { kind: "command_failed", message, command: name },
      );
    } finally {
      const event: WideEvent = {
        tool: name,
        outcome,
        duration_ms: Math.round(performance.now() - start),
      };
      if (args && typeof args === "object") {
        const record = args as Record<string, unknown>;
        event.argCount = Object.keys(record).length;
        if (typeof record.cwd === "string") event.cwd = record.cwd;
      }
      if (errorKind) event.errorKind = errorKind;
      log.logEvent(event);
    }
  };

  server.registerTool(
    name,
    config,
    wrapped as unknown as ToolCallback<InputArgs>,
  );
}
