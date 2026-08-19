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
import { err, zeroOf } from "#response";

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
  /**
   * Raw CLI command(s) this structured tool approximates. Folded into the tool's
   * MCP `_meta` (so clients can show "here is what I would have run") and captured
   * in the tool registry for the generated reference (`docs/tools.md`).
   */
  equivalentCommands?: string[];
  /**
   * Arguments the tool cannot run without, checked here rather than by the SDK.
   *
   * A Zod-required field is rejected at the SDK boundary as `MCP error -32602`
   * before any of this wrapper runs: the caller gets a protocol error with no
   * `structuredContent`, no error kind, and no hint about which argument was
   * missing. Declaring the field `.optional()` in `inputSchema` and naming it
   * here moves the check inside, so an omitted argument comes back as an
   * ordinary `invalid_input` result the agent can read and retry from.
   */
  required?: string[];
}

/**
 * A flattened record of a registered tool, captured as a side effect of
 * `defineTool` for doc generation. Read via `getRegisteredTools()`; the live
 * server ignores it. See `src/registry.ts` for `buildRegistry()`.
 */
export interface ToolRecord {
  name: string;
  title?: string;
  description?: string;
  readOnlyHint?: boolean;
  equivalentCommands?: string[];
  /** Arguments enforced by the wrapper rather than by the schema. */
  required?: string[];
  inputSchema?: ZodRawShape;
  outputSchema?: ZodRawShape;
  /**
   * README category, assigned by `buildRegistry()` from the tool group's label
   * (not set by `defineTool`, which is group-agnostic). Drives the grouped
   * "## Tools" section in README.md.
   */
  category?: string;
}

const registry: ToolRecord[] = [];

/** Tools registered via `defineTool` since the last reset (insertion order). */
export function getRegisteredTools(): ToolRecord[] {
  return registry;
}

/** Clear the registry — call before re-registering to avoid duplicates. */
export function resetRegistry(): void {
  registry.length = 0;
}

/** Minimal shape we read off a handler result for outcome classification. */
interface ResultShape {
  isError?: boolean;
  content?: { type: string; text: string }[];
  structuredContent?: { error?: { kind?: string } };
}

/**
 * Which of a tool's `required` arguments the caller left out.
 *
 * `undefined` and `null` count as absent; `""`, `0`, and `false` do not — an
 * empty string is a caller's answer, not a missing one.
 */
function missingArgs(required: string[] | undefined, args: unknown): string[] {
  if (!required || required.length === 0) return [];
  const record = (args ?? {}) as Record<string, unknown>;
  return required.filter(
    (key) => record[key] === undefined || record[key] === null,
  );
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

  // The error path's payload comes from the declared schema, computed once
  // here rather than restated as a literal beside every `err(...)` — see
  // ADR-0011. Handlers pass only what the zero cannot know; that wins the merge.
  const zero = config.outputSchema ? zeroOf(config.outputSchema) : {};

  const wrapped = async (...callArgs: unknown[]) => {
    const args = callArgs[0];
    const start = performance.now();
    let outcome: WideEvent["outcome"] = "success";
    let errorKind: string | undefined;

    try {
      const missing = missingArgs(config.required, args);
      if (missing.length > 0) {
        outcome = "error";
        errorKind = "invalid_input";
        const message = `${name}: missing required argument${
          missing.length > 1 ? "s" : ""
        } ${missing.join(", ")}`;
        const failed = err(
          message,
          {},
          {
            kind: "invalid_input",
            message,
            command: name,
            suggestion: `Call ${name} with ${missing
              .map((a) => `${a}: <value>`)
              .join(", ")}.`,
          },
        );
        return {
          ...failed,
          structuredContent: { ...zero, ...failed.structuredContent },
        };
      }

      const result = (await call(...callArgs)) as ResultShape;
      if (result?.isError) {
        outcome = "error";
        errorKind = result.structuredContent?.error?.kind;
        return {
          ...result,
          structuredContent: { ...zero, ...result.structuredContent },
        };
      }
      // A payload with nothing worth summarizing (every field empty or false)
      // summarizes to "". `ok()` cannot know the tool name; here we do, and a
      // blank text block reads as a dropped response.
      if (result?.content?.[0]?.text === "") {
        return { ...result, content: [{ type: "text", text: name }] };
      }
      return result;
    } catch (e) {
      outcome = "error";
      errorKind = "command_failed";
      const message = e instanceof Error ? e.message : String(e);
      const thrown = err(
        message,
        {},
        { kind: "command_failed", message, command: name },
      );
      return {
        ...thrown,
        structuredContent: { ...zero, ...thrown.structuredContent },
      };
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

  // Fold equivalentCommands into _meta (preserving any caller _meta) and keep it
  // out of the config the SDK sees. Capture a flattened record for doc gen.
  const { equivalentCommands, required, ...rest } = config;
  const meta = equivalentCommands
    ? { ...config._meta, equivalentCommands }
    : config._meta;
  const registerConfig = meta ? { ...rest, _meta: meta } : rest;

  registry.push({
    name,
    title: config.title,
    description: config.description,
    readOnlyHint: config.annotations?.readOnlyHint,
    equivalentCommands,
    required,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
  });

  server.registerTool(
    name,
    registerConfig,
    wrapped as unknown as ToolCallback<InputArgs>,
  );
}
