import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixturesRoot } from "../scripts/benchmark-core.mjs";

/**
 * Frozen baselines are what every later measurement is compared against, so
 * they are never regenerated. `scripts/capture-baseline.mjs` refuses to
 * overwrite one; this pins the bytes so a hand edit fails too.
 */
const PINNED: Record<string, string> = {
  "v4.0.0": "1adb6b4ac39a7abcff1659bed8a8c2288765322da7d1fe52e0d05c11399f0b9a",
};

describe("benchmark baselines", () => {
  it.each(Object.entries(PINNED))("%s is unchanged", (name, sha) => {
    const bytes = readFileSync(join(fixturesRoot, "baselines", `${name}.json`));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha);
  });
});
