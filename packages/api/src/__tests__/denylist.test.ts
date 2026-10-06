import { describe, it, expect, vi, beforeEach } from "vitest";
import type pg from "pg";
import { isDenied, reloadDenylist, resetDenylist } from "../denylist.js";

const HOUR_MS = 60 * 60 * 1000;

function poolReturning(rows: { client_key: string; banned_until: Date | null }[]) {
  return { query: vi.fn(async () => ({ rows })) } as unknown as pg.Pool;
}

beforeEach(() => {
  resetDenylist();
});

describe("denylist", () => {
  it("mirrors permanent and timed bans from client_bans", async () => {
    await reloadDenylist(
      poolReturning([
        { client_key: "203.0.113.7", banned_until: null },
        { client_key: "2001:db8:0:1::/64", banned_until: new Date(Date.now() + HOUR_MS) },
      ]),
    );
    expect(isDenied("203.0.113.7")).toBe(true);
    expect(isDenied("2001:db8:0:1::/64")).toBe(true);
    expect(isDenied("198.51.100.9")).toBe(false);
  });

  // A ban removed by hand must lift on the next reload, not linger in memory.
  it("drops bans that left the table", async () => {
    await reloadDenylist(poolReturning([{ client_key: "203.0.113.7", banned_until: null }]));
    await reloadDenylist(poolReturning([]));
    expect(isDenied("203.0.113.7")).toBe(false);
  });

  it("lets a timed ban lapse between reloads", async () => {
    const start = Date.now();
    await reloadDenylist(
      poolReturning([{ client_key: "203.0.113.7", banned_until: new Date(start + HOUR_MS) }]),
    );
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(start + HOUR_MS + 1);
    try {
      expect(isDenied("203.0.113.7")).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
