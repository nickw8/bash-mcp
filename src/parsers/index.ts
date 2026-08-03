/**
 * The `#parsers` barrel — everything shared across tool groups for turning CLI
 * output into a payload.
 *
 * Import through `#parsers`, never by relative path: a group also has its own
 * `src/tools/<group>/parsers/` directory, and `../../parsers/x.js` reads like
 * one of those. The subpath is the only unambiguous spelling.
 */

export * from "./diagnostic-line.js";
export * from "./diagnostics-response.js";
export * from "./json-output.js";
export * from "./schemas.js";
export * from "./strip-prefix.js";
export * from "./types.js";
