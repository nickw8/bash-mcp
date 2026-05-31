/**
 * Generic prefix stripping for arrays of strings.
 *
 * Used by diagnostic parsers to shorten file paths (separator "/")
 * and test parsers to shorten namespace-qualified test names (separator ".").
 */

/**
 * Find and remove the longest common prefix from an array of strings,
 * split by the given separator. Keeps at least `minKeepSegments` trailing
 * segments to preserve meaningful context.
 */
export function stripCommonPrefix(
  values: string[],
  separator: string,
  minKeepSegments = 1,
): string[] {
  if (values.length === 0) return values;

  const segments = (values[0] ?? "").split(separator);
  let prefixLen = 0;

  for (let i = 0; i < segments.length - minKeepSegments; i++) {
    const candidate = `${segments.slice(0, i + 1).join(separator)}${separator}`;
    if (values.every((v) => v.startsWith(candidate))) {
      prefixLen = candidate.length;
    } else {
      break;
    }
  }

  if (prefixLen === 0) return values;
  return values.map((v) => v.slice(prefixLen));
}
