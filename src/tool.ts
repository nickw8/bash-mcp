/**
 * defineTool — cross-cutting wrapper around server.registerTool.
 *
 * Pattern: Decorator (`/arch:guide` Boundary pain). Instead of editing every
 * handler, `defineTool` wraps the handler once to:
 *   - time the call and emit exactly one wide event (in `finally`),
 *   - derive `outcome` from `result.isError` (not just thrown errors), and
 *   - convert a thrown error into a uniform `err(...)` response,
 *   - hand the request's AbortSignal to `#exec`, and
 *   - fit the result to the response budget (`#budget`).
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
import { type ZodRawShape, z } from "zod";
import {
  capText,
  fitToBudget,
  isUnhealthy,
  limitFor,
  type ResponseMode,
  responseModeFromEnv,
} from "#budget";
import { callSignal } from "#exec";
import { logger as defaultLogger, type Logger, type WideEvent } from "#logger";
import { err, zeroOf } from "#response";
import { resultStore, sessionOf } from "#result-store";

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
  /**
   * Declares a Diagnostic tool: one whose output carries the Triage envelope
   * (`triageSchema`). Stripped before the SDK sees it; recorded on the
   * `ToolRecord` so docs read the declaration instead of sniffing the schema.
   * A guard test holds the mark and the envelope together.
   */
  diagnostic?: true;
  /**
   * `false` keeps a budget-trimmed result out of the result store. Only
   * `result_get` sets it: its own output is already a slice of a stored
   * result, so storing it again would only fill the store with copies.
   */
  retain?: false;
}

/**
 * Added to every `outputSchema`: present only when the response budget cut the
 * payload, as `{ mode, omitted: [{ path, total, shown }], id?, expiresInSec? }`.
 * `id` is absent when the full result could not be kept (store disabled, or
 * the result too big for it). Advertised as an open object, not that typed
 * shape: the typed schema cost ~100 tokens on each of 60+ tools in
 * `tools/list`, and the shape is documented once in output-conventions.md.
 */
const retainedSchema = z.record(z.unknown()).optional();

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
  /** Declared Diagnostic tool — see `ToolConfig.diagnostic`. */
  diagnostic?: true;
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
interface ResultShape extends BudgetResult {
  structuredContent?: { error?: { kind?: string } } & Record<string, unknown>;
}

/**
 * Which of a tool's `required` arguments the caller left out.
 *
 * `undefined`, `null`, and an empty array count as absent; `""`, `0`, and
 * `false` do not — an empty string is a caller's answer, not a missing one.
 *
 * The empty array is here rather than as a `.min(1)` on each schema because a
 * tool that needs a list needs a non-empty one, and one guard covers every
 * array argument at once. Without it `bash_syntax_check({ files: [] })` checked
 * nothing and answered `valid: true`, which is worse than an error.
 */
function missingArgs(required: string[] | undefined, args: unknown): string[] {
  if (!required || required.length === 0) return [];
  const record = (args ?? {}) as Record<string, unknown>;
  return required.filter((key) => {
    const value = record[key];
    return (
      value === undefined ||
      value === null ||
      (Array.isArray(value) && value.length === 0)
    );
  });
}

/** A caller who asked for `detailLevel: "full"` gets the payload uncut. */
function modeFor(args: unknown): ResponseMode {
  const detail = (args as { detailLevel?: unknown } | undefined)?.detailLevel;
  return detail === "full" ? "full" : responseModeFromEnv();
}

interface BudgetResult {
  isError?: boolean;
  content?: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

/**
 * Fit a result to the response budget (`#budget`). A trimmed payload gains a
 * `retained` block naming what was cut, the whole payload goes to the result
 * store, and the text block says how to fetch the rest.
 */
function budgeted<R extends BudgetResult>(
  name: string,
  result: R,
  args: unknown,
  extra: unknown,
  retain: boolean,
): R {
  const payload = result?.structuredContent;
  const mode = modeFor(args);
  if (!payload || mode === "full") return result;
  const limit = limitFor(mode, isUnhealthy(payload, result.isError === true));
  const fit = fitToBudget(payload, limit);
  // The text block is held to the same limit: a list tool's tsv/bare text
  // restates every row, so a cut payload beside an uncut text saves nothing.
  const [first, ...others] = result.content ?? [];
  const text = first ? capText(first.text, limit) : undefined;
  if (fit.omitted.length === 0) {
    return text === first?.text
      ? result
      : { ...result, content: [{ type: "text", text }, ...others] };
  }
  const id = retain
    ? resultStore.put(sessionOf(extra), name, payload, fit.originalSize)
    : undefined;
  const retained = {
    mode,
    omitted: fit.omitted,
    ...(id ? { id, expiresInSec: resultStore.ttlSec } : {}),
  };
  const cuts = fit.omitted
    .map((o) => `${o.path} ${o.shown}/${o.total}`)
    .join(", ");
  const how = id
    ? `rest: result_get {"id":"${id}"} (${resultStore.ttlSec}s)`
    : `rest not kept; narrow the call or pass detailLevel "full" where supported`;
  const note = `[truncated to ${mode} budget: ${cuts}; ${how}]`;
  return {
    ...result,
    content: [
      { type: "text", text: text ? `${text} ${note}` : note },
      ...others,
    ],
    structuredContent: { ...fit.payload, retained },
  };
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
    // The SDK calls a tool without an inputSchema as handler(extra), not
    // handler(args, extra).
    const [args, extra] = config.inputSchema
      ? callArgs
      : [undefined, callArgs[0]];
    const withBudget = <R extends BudgetResult>(r: R): R =>
      budgeted(name, r, args, extra, config.retain !== false);
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

      // Commands the handler runs see this request's AbortSignal (`#exec`).
      const signal = (extra as { signal?: AbortSignal } | undefined)?.signal;
      const result = (await callSignal.run(signal, () =>
        call(...callArgs),
      )) as ResultShape;
      if (result?.isError) {
        outcome = "error";
        errorKind = result.structuredContent?.error?.kind;
        return withBudget({
          ...result,
          structuredContent: { ...zero, ...result.structuredContent },
        });
      }
      // A payload with nothing worth summarizing (every field empty or false)
      // summarizes to "". `ok()` cannot know the tool name; here we do, and a
      // blank text block reads as a dropped response.
      if (result?.content?.[0]?.text === "") {
        return withBudget({
          ...result,
          content: [{ type: "text", text: name }],
        });
      }
      return withBudget(result);
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
  const { equivalentCommands, required, diagnostic, retain, ...rest } = config;
  const meta = equivalentCommands
    ? { ...config._meta, equivalentCommands }
    : config._meta;
  // An argument the tool does not declare is an error, not something to drop.
  // The SDK builds a strip-mode object out of a raw shape, so
  // `git_diff_content({ repoPath, commit, nameOnly })` lost all three keys,
  // diffed the default repo at the default ref, and answered as if that were
  // the question. The advertised JSON Schema already says
  // `additionalProperties: false`; `.strict()` makes the server agree with it
  // and name the keys it refused, which is what lets the agent retry.
  //
  // A `required` field is `.optional()` in Zod (ADR-0013), so the advertised
  // JSON Schema cannot list it as required; its description says so instead,
  // or the caller learns it only from the failed first call.
  const inputShape = config.inputSchema
    ? Object.fromEntries(
        Object.entries(config.inputSchema).map(([key, field]) => [
          key,
          required?.includes(key)
            ? field.describe(`Required. ${field.description ?? ""}`.trim())
            : field,
        ]),
      )
    : undefined;
  const registerConfig = {
    ...rest,
    ...(inputShape ? { inputSchema: z.object(inputShape).strict() } : {}),
    ...(config.outputSchema
      ? { outputSchema: { ...config.outputSchema, retained: retainedSchema } }
      : {}),
    ...(meta ? { _meta: meta } : {}),
  } as unknown as ToolConfig<InputArgs, OutputArgs>;

  registry.push({
    name,
    title: config.title,
    description: config.description,
    readOnlyHint: config.annotations?.readOnlyHint,
    equivalentCommands,
    required,
    diagnostic,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
  });

  server.registerTool(
    name,
    registerConfig,
    wrapped as unknown as ToolCallback<InputArgs>,
  );
}
