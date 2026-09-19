import { describe, it, expect, vi, beforeEach } from "vitest";
import { drainAndClosePool } from "../shutdown.js";

describe("drainAndClosePool", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("closes the pool only after in-flight cycles genuinely settle", async () => {
    // The failure this guards: `pool.end()` destroys idle clients and waits for
    // checked-out ones, so closing while a cycle is mid-query kills a query
    // under a half-written poll. Ordering is the whole assertion.
    const order: string[] = [];
    let releaseCycle!: () => void;
    const cycle = new Promise<void>((resolve) => {
      releaseCycle = () => {
        order.push("cycle settled");
        resolve();
      };
    });

    let cancelled = false;
    const result = drainAndClosePool({
      stopTimers: () => order.push("timers stopped"),
      cancelCycles: () => {
        cancelled = true;
        order.push("cancelled");
        // A cycle that observes its signal settles promptly, which is what
        // makes the drain fast rather than a wall-clock wait.
        setTimeout(releaseCycle, 10);
      },
      inFlight: () => [cycle],
      closePool: async () => {
        order.push("pool closed");
      },
    });

    expect(cancelled).toBe(true);
    expect(order).toEqual(["timers stopped", "cancelled"]); // not closed yet

    await expect(result).resolves.toEqual({ drained: true, poolClosed: true });
    expect(order).toEqual(["timers stopped", "cancelled", "cycle settled", "pool closed"]);
  });

  it("does not wait on a cycle that already rejected", async () => {
    const closePool = vi.fn(async () => {});
    const result = await drainAndClosePool({
      stopTimers: () => {},
      cancelCycles: () => {},
      // Shutdown cancels cycles, so most in-flight promises REJECT. Awaiting
      // them with `Promise.all` would throw out of the drain and skip the close.
      inFlight: () => [Promise.reject(new Error("cancelled"))],
      closePool,
    });

    expect(result).toEqual({ drained: true, poolClosed: true });
    expect(closePool).toHaveBeenCalledOnce();
  });

  it("does NOT close the pool when a cycle ignores its cancellation", async () => {
    // A drain timeout means a cycle is still holding a client and may be
    // mid-query. Closing "anyway" is the same torn-write it is ordered to
    // prevent, just 30s later — so the pool is left to process teardown and the
    // failure is reported instead.
    const closePool = vi.fn(async () => {});
    const result = await drainAndClosePool({
      stopTimers: () => {},
      cancelCycles: () => {},
      inFlight: () => [new Promise<void>(() => {})], // never settles
      closePool,
      drainTimeoutMs: 10,
    });

    expect(result).toEqual({ drained: false, poolClosed: false });
    expect(closePool).not.toHaveBeenCalled();
    // Still bounded: a wedged stage must not turn SIGTERM into a hang.
  });

  it("bounds the pool close so exit is always reached", async () => {
    // The drain must SUCCEED here, or the early return above would skip
    // `closePool` entirely and this would assert nothing about its budget.
    const result = await drainAndClosePool({
      stopTimers: () => {},
      cancelCycles: () => {},
      inFlight: () => [],
      closePool: () => new Promise<void>(() => {}), // never resolves
      drainTimeoutMs: 10,
      poolCloseTimeoutMs: 10,
    });

    expect(result).toEqual({ drained: true, poolClosed: false });
  });

  it("treats a failed pool close as closed rather than hanging shutdown", async () => {
    const result = await drainAndClosePool({
      stopTimers: () => {},
      cancelCycles: () => {},
      inFlight: () => [],
      closePool: async () => {
        throw new Error("pool already ended");
      },
    });

    expect(result).toEqual({ drained: true, poolClosed: true });
  });

  it("stops timers before cancelling, so no new cycle can start", async () => {
    const order: string[] = [];
    await drainAndClosePool({
      stopTimers: () => order.push("stopTimers"),
      cancelCycles: () => order.push("cancelCycles"),
      inFlight: () => {
        // Snapshot taken after cancelling, so it includes every started cycle.
        order.push("inFlight");
        return [];
      },
      closePool: async () => {
        order.push("closePool");
      },
    });

    expect(order).toEqual(["stopTimers", "cancelCycles", "inFlight", "closePool"]);
  });
});
