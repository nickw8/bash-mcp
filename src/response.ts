/**
 * MCP Response Helpers
 *
 * Every tool returns both a text `content` array (for display) and
 * a typed `structuredContent` object (for programmatic use). These
 * helpers eliminate the boilerplate of assembling that shape.
 */

import type { ZodRawShape, ZodTypeAny } from "zod";
import type { ToolError } from "#error";
import { formatList, type ListFormat, projectRows } from "#format";

/**
 * The zero value of one declared field.
 *
 * Wrappers are unwrapped first: an optional field has no zero (the key is
 * omitted), a nullable one is `null`, a defaulted one uses its default.
 * Anything with no obvious empty value — a union, an unknown, an enum — is
 * `null`, which is what the hand-written error payloads already used for
 * exactly those fields. A handler that needs something else passes it to
 * `err` and wins the merge.
 */
const OMIT = Symbol("omit");

function zeroOfType(schema: ZodTypeAny): unknown {
  // biome-ignore lint/suspicious/noExplicitAny: zod's _def is untyped by design
  const def = (schema as any)._def;
  switch (def?.typeName) {
    case "ZodOptional":
      return OMIT;
    case "ZodDefault":
      return def.defaultValue();
    case "ZodNullable":
      return null;
    case "ZodEffects":
      return zeroOfType(def.schema);
    case "ZodString":
      return "";
    case "ZodNumber":
    case "ZodBigInt":
      return 0;
    case "ZodBoolean":
      return false;
    case "ZodArray":
      return [];
    case "ZodRecord":
    case "ZodMap":
      return {};
    case "ZodObject":
      return zeroOf(def.shape());
    case "ZodTuple":
      return (def.items as ZodTypeAny[]).map(zeroOfType);
    case "ZodLiteral":
      return def.value;
    default:
      return null;
  }
}

/**
 * Derive the zero-valued payload a tool's `outputSchema` describes.
 *
 * The schema is the single definition of a tool's payload shape; the error
 * path used to restate it as a literal beside every `err(...)`, so a renamed
 * field left the error branches quietly returning the old shape (ADR-0011).
 * `defineTool` calls this once per tool at registration and merges the result
 * underneath whatever the handler passed to `err`.
 */
export function zeroOf(shape: ZodRawShape): Record<string, unknown> {
  const zero: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape)) {
    const value = zeroOfType(field as ZodTypeAny);
    if (value !== OMIT) zero[key] = value;
  }
  return zero;
}

/** Build a successful MCP tool response with structured content. */
export function ok<T extends Record<string, unknown>>(structuredContent: T) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
  };
}

/**
 * Build a response for list-shaped data, formatting the text content
 * using the specified format while keeping structuredContent as JSON.
 *
 * `opts.fields` restricts the text block to the named columns (in order);
 * structuredContent is unaffected, so the agent can ask for exactly the columns
 * it needs without losing the full typed payload.
 */
export function okList<T extends Record<string, unknown>>(
  structuredContent: T,
  rows: Record<string, unknown>[],
  meta: Record<string, unknown>,
  format: ListFormat = "json",
  opts: { fields?: string[] } = {},
) {
  const text =
    format === "json"
      ? JSON.stringify(structuredContent)
      : formatList(projectRows(rows, opts.fields), format, meta);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}

/**
 * Build an error MCP tool response.
 *
 * `structuredContent` carries only what the tool's `outputSchema` cannot know —
 * the path that failed, a pod name, a non-zero exit code. `defineTool` merges
 * `zeroOf(outputSchema)` underneath, so the rest of the payload comes from the
 * schema itself and cannot drift from it (ADR-0011). Omit it entirely when the
 * zero says everything.
 *
 * When a `ToolError` is supplied, it is merged in as `{ ok: false, error }`
 * so agents get a machine-readable recovery signal. This is safe even for
 * tools that declare an `outputSchema` — the MCP SDK skips output validation
 * on `isError: true` results.
 */
export function err<T extends Record<string, unknown>>(
  message: string,
  structuredContent: T = {} as T,
  error?: ToolError,
) {
  const structured = error
    ? { ...structuredContent, ok: false as const, error }
    : structuredContent;
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: structured,
    isError: true,
  };
}
