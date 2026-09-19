/**
 * Graceful shutdown, kept out of `start.ts` so it can be tested without a live
 * pg connection, signal handlers, or `process.exit`.
 */

import { sleep } from "./abort.js";

/** Upper bound on waiting for in-flight polls. */
export const SHUTDOWN_DRAIN_TIMEOUT_MS = 30_000;
/** Upper bound on closing the pg pool afterwards, so exit is always reached. */
export const SHUTDOWN_POOL_CLOSE_TIMEOUT_MS = 5_000;

export interface ShutdownOptions {
  /** Stops the interval timers. Called first, so no new cycle can start. */
  stopTimers: () => void;
  /** Cancels running cycles. Called before draining, not instead of it. */
  cancelCycles: () => void;
  /** Snapshot taken after cancelling, so it includes every started cycle. */
  inFlight: () => Iterable<Promise<unknown>>;
  closePool: () => Promise<void>;
  drainTimeoutMs?: number;
  poolCloseTimeoutMs?: number;
}

export interface ShutdownResult {
  /** False when the drain timed out with cycles still running. */
  drained: boolean;
  /**
   * False when the pool was not closed — either `closePool` overran its budget,
   * or the drain failed and closing was deliberately skipped. Callers should
   * treat `drained: false` as a failed shutdown and exit non-zero.
   */
  poolClosed: boolean;
}

/**
 * Cancel, drain, then close — in that order, and with the ordering enforced.
 *
 * Cancelling first is what makes the drain fast: every stage observes the
 * signal, so cycles settle in milliseconds instead of running to completion
 * against a 30s wall. The drain is still bounded, because a stage that ignores
 * its signal must not turn SIGTERM into a SIGKILL.
 *
 * `closePool` runs only after the drain SUCCEEDS. `pool.end()` destroys idle
 * clients and waits for checked-out ones, so calling it while a cycle is
 * mid-query is how you get a query killed underneath a half-written poll. A
 * drain timeout means precisely that a cycle is still in flight, so closing
 * "anyway" at that point is the same corruption the ordering exists to prevent,
 * merely delayed by the drain budget. On a failed drain the pool is therefore
 * left alone and the failure is reported: process teardown reclaims the sockets,
 * and the OS does it without tearing a half-written transaction in half.
 *
 * The pool close is still bounded, so a pool that will not close cannot turn
 * SIGTERM into a hang.
 */
export async function drainAndClosePool(options: ShutdownOptions): Promise<ShutdownResult> {
  const drainTimeoutMs = options.drainTimeoutMs ?? SHUTDOWN_DRAIN_TIMEOUT_MS;
  const poolCloseTimeoutMs = options.poolCloseTimeoutMs ?? SHUTDOWN_POOL_CLOSE_TIMEOUT_MS;

  options.stopTimers();
  options.cancelCycles();

  const drained = await Promise.race([
    Promise.allSettled([...options.inFlight()]).then(() => true),
    sleep(drainTimeoutMs).then(() => false),
  ]);
  if (!drained) {
    // Deliberately NOT closing the pool. A cycle is still holding a client and
    // may be mid-query; ending the pool under it kills that query against a
    // half-written poll. Exiting with the pool open is the lesser harm.
    console.error(
      `Drain timed out after ${drainTimeoutMs}ms with cycles still in flight. ` +
        `NOT closing the pg pool — a cycle may be mid-query. Leaving connection ` +
        `teardown to process exit; shutdown is UNCLEAN and should exit non-zero.`,
    );
    return { drained: false, poolClosed: false };
  }

  const poolClosed = await Promise.race([
    options
      .closePool()
      .then(() => true)
      .catch(() => true),
    sleep(poolCloseTimeoutMs).then(() => false),
  ]);
  if (!poolClosed) {
    console.warn(`Pool close timed out after ${poolCloseTimeoutMs}ms; exiting`);
  }

  return { drained, poolClosed };
}
