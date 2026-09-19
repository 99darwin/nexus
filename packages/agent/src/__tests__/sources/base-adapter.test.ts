import { describe, it, expect, vi } from "vitest";
import type { RawItem } from "../../sources/types.js";
import { BaseAdapter } from "../../sources/base-adapter.js";

/**
 * The base adapter is the single chokepoint all five adapters inherit, so its
 * abort handling is what makes "a cancelled cycle settles promptly" true for
 * every source rather than for one of them.
 */
class TestAdapter extends BaseAdapter {
  name = "test";
  priority = "P1" as const;
  readonly fetches = vi.fn<(signal?: AbortSignal) => Promise<RawItem[]>>();

  constructor(impl: (signal?: AbortSignal) => Promise<RawItem[]>, maxRetries = 3) {
    super({ pollIntervalMs: 1000, maxRetries, rateLimitMs: 0 });
    this.fetches.mockImplementation(impl);
  }

  protected fetchItems(signal?: AbortSignal): Promise<RawItem[]> {
    return this.fetches(signal);
  }
}

describe("BaseAdapter cancellation", () => {
  it("forwards the signal to fetchItems", async () => {
    const controller = new AbortController();
    const adapter = new TestAdapter(async () => []);
    await adapter.poll(controller.signal);
    expect(adapter.fetches).toHaveBeenCalledWith(controller.signal);
  });

  it("does not fetch at all when already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("shutting down"));
    const adapter = new TestAdapter(async () => []);

    await expect(adapter.poll(controller.signal)).rejects.toThrow("shutting down");
    expect(adapter.fetches).not.toHaveBeenCalled();
  });

  it("does not retry after an abort", async () => {
    // Retrying a cancelled fetch issues more requests against a cycle nobody is
    // waiting for, and delays settlement by the whole backoff schedule (1s + 2s
    // here) while the mutex is held.
    const controller = new AbortController();
    const adapter = new TestAdapter(async () => {
      controller.abort(new Error("shutting down"));
      throw new Error("aborted");
    });

    await expect(adapter.poll(controller.signal)).rejects.toThrow("shutting down");
    expect(adapter.fetches).toHaveBeenCalledTimes(1);
  });

  it("reports the abort reason, not the fetch's own error, on the last attempt", async () => {
    // On the final attempt there is no backoff left to reject, so without the
    // explicit check the loop falls through to `throw lastError` — an aborted
    // cycle would surface as a transport failure, and `start.ts` logs a
    // cancelled poll as an error while `enrichItems` treats it as retryable.
    const controller = new AbortController();
    const adapter = new TestAdapter(async () => {
      controller.abort(new Error("shutting down"));
      throw new Error("fetch failed: socket hang up");
    }, 1);

    await expect(adapter.poll(controller.signal)).rejects.toThrow("shutting down");
  });

  it("still retries an ordinary failure", async () => {
    // Guard the guard: the abort check must not have disabled retries outright.
    let calls = 0;
    const adapter = new TestAdapter(async () => {
      if (++calls < 2) throw new Error("flaky");
      return [];
    });

    const started = Date.now();
    await expect(adapter.poll()).resolves.toEqual([]);
    expect(calls).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900); // one backoff elapsed
  });

  it("cancels the inter-attempt backoff instead of sleeping it out", async () => {
    // The backoff is where a cancelled poll would otherwise sit for seconds.
    const controller = new AbortController();
    const adapter = new TestAdapter(async () => {
      throw new Error("flaky");
    });

    const started = Date.now();
    const run = adapter.poll(controller.signal);
    setTimeout(() => controller.abort(new Error("shutting down")), 10);

    await expect(run).rejects.toThrow("shutting down");
    expect(Date.now() - started).toBeLessThan(500); // not the full 1s backoff
  });
});
