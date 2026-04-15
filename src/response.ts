/**
 * MCP Response Helpers
 *
 * Every tool returns both a text `content` array (for display) and
 * a typed `structuredContent` object (for programmatic use). These
 * helpers eliminate the boilerplate of assembling that shape.
 */

import { type ListFormat, formatList } from "./format.js";

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
 */
export function okList<T extends Record<string, unknown>>(
  structuredContent: T,
  rows: Record<string, unknown>[],
  meta: Record<string, unknown>,
  format: ListFormat = "json",
) {
  const text =
    format === "json"
      ? JSON.stringify(structuredContent)
      : formatList(rows, format, meta);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}

/** Build an error MCP tool response. */
export function err<T extends Record<string, unknown>>(
  message: string,
  structuredContent: T,
) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent,
    isError: true,
  };
}
