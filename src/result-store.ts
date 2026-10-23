/**
 * Session-scoped, in-memory store for results the response budget trimmed.
 *
 * When `defineTool` cuts a payload to fit the budget (`#budget`), it keeps the
 * whole payload here under an opaque id. `result_get` pages through it, so the
 * agent can read what was cut without running the command again.
 *
 * - Memory only. Nothing goes to disk, so a payload that held a secret is gone
 *   when the process exits or the entry expires.
 * - Bounded. An entry lives for a TTL. The store caps entry count and total
 *   bytes, and evicts the oldest entries first.
 * - Session-bound. Every entry records the session that produced it, and
 *   `get` refuses a session that does not match. A stdio server serves one
 *   client per process, so the session is "stdio" unless the transport names
 *   one.
 * - Snapshot. An entry is the command's output at `capturedAt`. Nothing
 *   invalidates it when files or cluster state change. Run the tool again for
 *   current data.
 *
 * Retrieval returns only what the tool already produced for that session, under
 * the same `BASH_MCP_MODE`, so it cannot widen what a caller may see.
 */

import { randomBytes } from "node:crypto";

export interface StoredResult {
  tool: string;
  payload: Record<string, unknown>;
  capturedAt: number;
  expiresAt: number;
}

interface Entry extends StoredResult {
  session: string;
  bytes: number;
}

export interface StoreLimits {
  /** Seconds an entry lives. 0 disables the store. */
  ttlSec: number;
  /** Total bytes across all entries. */
  maxBytes: number;
  maxEntries: number;
}

const DEFAULT_TTL_SEC = 900;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 100;
const TOMBSTONES = 1000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Limits from `BASH_MCP_RESULT_TTL` (seconds) and `BASH_MCP_RESULT_MAX_BYTES`. */
export function limitsFromEnv(): StoreLimits {
  return {
    ttlSec: envInt("BASH_MCP_RESULT_TTL", DEFAULT_TTL_SEC),
    maxBytes: envInt("BASH_MCP_RESULT_MAX_BYTES", DEFAULT_MAX_BYTES),
    maxEntries: MAX_ENTRIES,
  };
}

export type Lookup =
  | { found: true; result: StoredResult }
  | { found: false; reason: "not_found" | "expired" };

export class ResultStore {
  private readonly entries = new Map<string, Entry>();
  /** id → session of entries that expired, so a late lookup says "expired". */
  private readonly expired = new Map<string, string>();
  private bytes = 0;

  constructor(
    private readonly limits: StoreLimits = limitsFromEnv(),
    private readonly now: () => number = Date.now,
  ) {}

  get ttlSec(): number {
    return this.limits.ttlSec;
  }

  /**
   * Keep `payload` for `session`. Returns the id, or `undefined` when the store
   * is disabled or the payload is bigger than a quarter of the byte cap (one
   * result may not push out every other one).
   */
  put(
    session: string,
    tool: string,
    payload: Record<string, unknown>,
    bytes: number,
  ): string | undefined {
    const { ttlSec, maxBytes, maxEntries } = this.limits;
    if (ttlSec === 0 || bytes > maxBytes / 4) return undefined;
    this.sweep();
    while (
      this.entries.size > 0 &&
      (this.entries.size >= maxEntries || this.bytes + bytes > maxBytes)
    ) {
      const oldest = this.entries.keys().next().value as string;
      this.drop(oldest);
    }
    const id = `r_${randomBytes(12).toString("base64url")}`;
    const capturedAt = this.now();
    this.entries.set(id, {
      session,
      tool,
      payload,
      bytes,
      capturedAt,
      expiresAt: capturedAt + ttlSec * 1000,
    });
    this.bytes += bytes;
    return id;
  }

  /**
   * Look up `id` for `session`. Another session's id answers `not_found`, the
   * same as an id that never existed, so a caller cannot probe which ids are
   * live.
   */
  get(session: string, id: string): Lookup {
    const entry = this.entries.get(id);
    if (!entry || entry.session !== session) {
      return this.expired.get(id) === session
        ? { found: false, reason: "expired" }
        : { found: false, reason: "not_found" };
    }
    if (this.now() >= entry.expiresAt) {
      this.expire(id, entry);
      return { found: false, reason: "expired" };
    }
    const { session: _s, bytes: _b, ...result } = entry;
    return { found: true, result };
  }

  /** Entry count and bytes held, for tests. */
  stats(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.bytes };
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (now >= entry.expiresAt) this.expire(id, entry);
    }
  }

  private expire(id: string, entry: Entry): void {
    this.drop(id);
    this.expired.set(id, entry.session);
    if (this.expired.size > TOMBSTONES) {
      this.expired.delete(this.expired.keys().next().value as string);
    }
  }

  private drop(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.entries.delete(id);
  }
}

/** The process-wide store `defineTool` and `result_get` share. */
export const resultStore = new ResultStore();

/** Session key for an MCP request: the transport's id, or "stdio". */
export function sessionOf(extra: unknown): string {
  const id = (extra as { sessionId?: unknown } | undefined)?.sessionId;
  return typeof id === "string" && id !== "" ? id : "stdio";
}
