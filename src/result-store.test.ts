import { describe, expect, it } from "vitest";
import { ResultStore, sessionOf } from "./result-store.js";

const limits = { ttlSec: 60, maxBytes: 1_000, maxEntries: 3 };

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("ResultStore", () => {
  it("returns a stored result to the session that stored it", () => {
    const store = new ResultStore(limits, clock().now);
    const id = store.put("s1", "rg", { a: 1 }, 10) as string;
    expect(id).toMatch(/^r_[A-Za-z0-9_-]{16}$/);
    const got = store.get("s1", id);
    expect(got).toMatchObject({
      found: true,
      result: { tool: "rg", payload: { a: 1 } },
    });
  });

  it("answers not_found to another session, the same as an unknown id", () => {
    const store = new ResultStore(limits, clock().now);
    const id = store.put("s1", "rg", { a: 1 }, 10) as string;
    expect(store.get("s2", id)).toEqual({ found: false, reason: "not_found" });
    expect(store.get("s1", "r_nope")).toEqual({
      found: false,
      reason: "not_found",
    });
  });

  it("expires entries after the TTL and still says expired once swept", () => {
    const c = clock();
    const store = new ResultStore(limits, c.now);
    const id = store.put("s1", "rg", { a: 1 }, 10) as string;
    c.advance(60_000);
    expect(store.get("s1", id)).toEqual({ found: false, reason: "expired" });
    expect(store.get("s1", id)).toEqual({ found: false, reason: "expired" });
    // A foreign session learns nothing from the tombstone either.
    expect(store.get("s2", id)).toEqual({ found: false, reason: "not_found" });
    expect(store.stats()).toEqual({ entries: 0, bytes: 0 });
  });

  it("evicts the oldest entries to stay under the entry and byte caps", () => {
    const store = new ResultStore(limits, clock().now);
    const ids = [1, 2, 3, 4].map(
      (n) => store.put("s", "t", { n }, 100) as string,
    );
    expect(store.get("s", ids[0] as string).found).toBe(false);
    expect(store.get("s", ids[3] as string).found).toBe(true);
    expect(store.stats().entries).toBe(3);
    store.put("s", "t", {}, 250);
    store.put("s", "t", {}, 250);
    expect(store.stats().bytes).toBeLessThanOrEqual(1_000);
  });

  it("refuses a result bigger than a quarter of the byte cap", () => {
    const store = new ResultStore(limits, clock().now);
    expect(store.put("s", "t", {}, 251)).toBeUndefined();
  });

  it("is disabled by a zero TTL", () => {
    const store = new ResultStore({ ...limits, ttlSec: 0 }, clock().now);
    expect(store.put("s", "t", {}, 1)).toBeUndefined();
  });
});

describe("sessionOf", () => {
  it("uses the transport session id, else stdio", () => {
    expect(sessionOf({ sessionId: "abc" })).toBe("abc");
    expect(sessionOf({})).toBe("stdio");
    expect(sessionOf(undefined)).toBe("stdio");
  });
});
