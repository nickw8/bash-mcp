import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildRegistry } from "./registry.js";
import { zeroOf } from "./response.js";

/**
 * The error payload is derived from the declared `outputSchema` (ADR-0011), so
 * the one thing that must hold is that the derived zero satisfies the schema it
 * came from. Registry-driven, so it covers every tool that exists now and every
 * tool added later without anyone remembering to extend this file.
 */
describe("zeroOf", () => {
  it.each(
    buildRegistry().filter((t) => t.outputSchema),
  )("$name: the zero satisfies its own outputSchema", (tool) => {
    const shape = tool.outputSchema ?? {};
    expect(() => z.object(shape).parse(zeroOf(shape))).not.toThrow();
  });

  it("maps each Zod type to its empty value", () => {
    expect(
      zeroOf({
        text: z.string(),
        n: z.number(),
        flag: z.boolean(),
        list: z.array(z.string()),
        map: z.record(z.unknown()),
        nested: z.object({ inner: z.string(), deep: z.array(z.number()) }),
        pair: z.tuple([z.number(), z.number()]),
      }),
    ).toEqual({
      text: "",
      n: 0,
      flag: false,
      list: [],
      map: {},
      nested: { inner: "", deep: [] },
      pair: [0, 0],
    });
  });

  it("omits optional keys, nulls what has no empty value, and honours defaults", () => {
    expect(
      zeroOf({
        maybe: z.string().optional(),
        nullable: z.string().nullable(),
        either: z.union([z.string(), z.null()]),
        anything: z.unknown(),
        preset: z.number().default(30),
      }),
    ).toEqual({
      nullable: null,
      either: null,
      anything: null,
      preset: 30,
    });
  });
});
