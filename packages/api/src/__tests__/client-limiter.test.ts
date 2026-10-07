import { describe, it, expect, vi, afterEach } from "vitest";
import { createClientLimiter, type ClientLimiterConfig } from "../client-limiter.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

let offset = 0;
const start = Date.now();
vi.spyOn(Date, "now").mockImplementation(() => start + offset);

afterEach(() => {
  offset = 0;
});

function limiterWith(overrides: Partial<ClientLimiterConfig> = {}) {
  return createClientLimiter({
    windows: [
      { windowMs: MINUTE_MS, maxRequests: 3 },
      { windowMs: HOUR_MS, maxRequests: 5 },
    ],
    maxStrikes: 2,
    banDurationsMs: [HOUR_MS, DAY_MS],
    strikeDecayMs: HOUR_MS,
    escalationDecayMs: 7 * DAY_MS,
    maxTracked: 100,
    ...overrides,
  });
}

/** Sends `count` requests and returns the last result. */
function burst(limiter: ReturnType<typeof limiterWith>, key: string, count: number): number {
  let result = 0;
  for (let i = 0; i < count; i += 1) result = limiter.check(key);
  return result;
}

describe("client limiter", () => {
  it("trips the short window first", () => {
    const limiter = limiterWith();
    expect(burst(limiter, "a", 3)).toBe(0);
    expect(limiter.check("a")).toBe(MINUTE_MS);
  });

  // Pacing under the per-minute cap must not dodge the hourly budget.
  it("enforces the longer window across short-window resets", () => {
    const limiter = limiterWith();
    expect(burst(limiter, "a", 3)).toBe(0);
    offset += MINUTE_MS;
    expect(burst(limiter, "a", 2)).toBe(0);
    expect(limiter.check("a")).toBe(HOUR_MS - MINUTE_MS);
  });

  it("keeps clients independent", () => {
    const limiter = limiterWith();
    burst(limiter, "a", 4);
    expect(limiter.check("b")).toBe(0);
  });

  it("escalates bans from an hour to a day and reports each", () => {
    const onBan = vi.fn();
    const limiter = limiterWith({ onBan });

    burst(limiter, "a", 4); // strike 1: minute window
    offset += MINUTE_MS;
    expect(burst(limiter, "a", 3)).toBe(HOUR_MS); // strike 2 → first ban
    offset += HOUR_MS;

    burst(limiter, "a", 4);
    offset += MINUTE_MS;
    expect(burst(limiter, "a", 4)).toBe(DAY_MS);

    expect(onBan.mock.calls).toEqual([
      ["a", HOUR_MS],
      ["a", DAY_MS],
    ]);
  });

  it("forgives the escalation level after a clean week", () => {
    const limiter = limiterWith();
    burst(limiter, "a", 4);
    offset += MINUTE_MS;
    burst(limiter, "a", 3); // first ban
    offset += 8 * DAY_MS;

    burst(limiter, "a", 4);
    offset += MINUTE_MS;
    expect(burst(limiter, "a", 4)).toBe(HOUR_MS);
  });

  it("turns new clients away rather than evicting a live ban", () => {
    const limiter = limiterWith({ maxTracked: 1, maxStrikes: 1 });
    burst(limiter, "a", 4); // banned
    expect(limiter.check("b")).toBe(MINUTE_MS);
    expect(limiter.check("a")).toBeGreaterThan(0);
  });
});
