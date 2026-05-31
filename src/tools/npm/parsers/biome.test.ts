/**
 * Tests for the Biome diagnostic parser.
 */

import { describe, expect, it } from "vitest";
import { parseBiomeDiagnostics } from "./biome.js";

describe("parseBiomeDiagnostics", () => {
  it("parses biome JSON diagnostics", () => {
    const input = JSON.stringify({
      diagnostics: [
        {
          category: "lint/style/noNonNullAssertion",
          severity: "warning",
          description: "Forbidden non-null assertion.",
          location: {
            path: { file: "src/app.ts" },
            span: { start: 0, end: 10 },
            sourceCode: "const x = y!;",
          },
        },
      ],
    });

    const result = parseBiomeDiagnostics(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("warning");
    expect(result[0]?.rule).toBe("lint/style/noNonNullAssertion");
    expect(result[0]?.file).toBe("src/app.ts");
  });
});
