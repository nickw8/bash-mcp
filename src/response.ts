/**
 * MCP Response Helpers
 *
 * Every tool returns both a text `content` array (for display) and
 * a typed `structuredContent` object (for programmatic use). These
 * helpers eliminate the boilerplate of assembling that shape.
 */

/** Build a successful MCP tool response with structured content. */
export function ok<T extends Record<string, unknown>>(structuredContent: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

/** Build an error MCP tool response. */
export function err<T extends Record<string, unknown>>(message: string, structuredContent: T) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent,
    isError: true,
  };
}
