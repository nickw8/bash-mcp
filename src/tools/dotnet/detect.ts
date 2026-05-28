import { readdirSync } from "node:fs";

/**
 * Auto-detect a .sln file in the given directory.
 * Returns the filename if exactly one .sln is found, undefined otherwise.
 */
export function detectSolution(cwd: string): string | undefined {
  try {
    const entries = readdirSync(cwd);
    const slnFiles = entries.filter((e) => e.endsWith(".sln"));
    return slnFiles.length === 1 ? slnFiles[0] : undefined;
  } catch {
    return undefined;
  }
}
