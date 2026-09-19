/**
 * Cancellation primitives shared by the poll cycle, the adapters and the Jev
 * client.
 *
 * The distinction that matters here is between *abandoning* an operation and
 * *cancelling* it. `Promise.race([work, timeout])` abandons: the race settles,
 * but `work` keeps running, keeps holding its pg client, and can still write
 * rows minutes later. Everything below cancels instead — the deadline aborts a
 * signal that the work itself observes, and the caller then waits for the work
 * to genuinely settle.
 *
 * That "and then waits" is the whole point. A caller that does not await real
 * settlement cannot claim the operation has stopped.
 */

/** Deadline breach. Carries "timed out" so callers can log a cause, not an AbortError. */
export class TimeoutError extends Error {
  constructor(
    label: string,
    readonly timeoutMs: number,
  ) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * `setTimeout` as a promise that rejects as soon as `signal` aborts.
 *
 * Without the signal a shutdown would still have to sit through the longest
 * pending backoff — 30s of adapter retry, or a Jev rate-limit wait — before the
 * cycle it is cancelling could settle.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(signal.reason as Error);

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason as Error);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Mirror `parent`'s abort onto `child`. Returns an unsubscribe function.
 *
 * `AbortSignal.any` would do this, but it gives back a signal rather than a
 * controller, and the deadline below needs to abort with its own reason so the
 * caller can tell "we ran out of time" from "shutdown cancelled us".
 */
function forwardAbort(parent: AbortSignal | undefined, child: AbortController): () => void {
  if (!parent) return () => {};
  if (parent.aborted) {
    child.abort(parent.reason);
    return () => {};
  }
  const onAbort = () => child.abort(parent.reason);
  parent.addEventListener("abort", onAbort, { once: true });
  return () => parent.removeEventListener("abort", onAbort);
}

export interface AbortTimeoutOptions {
  /** Deadline for the operation. */
  ms: number;
  /** Used in the timeout message, e.g. `poll:rss`. */
  label: string;
  /** Aborting this aborts the operation too (shutdown, or an outer deadline). */
  parent?: AbortSignal;
  /** Fired when the deadline trips, before the operation has settled. */
  onTimeout?: () => void;
}

/**
 * Run `fn` under a deadline and **await its real settlement**.
 *
 * On timeout the signal is aborted and the returned promise still does not
 * settle until `fn` does. So a caller holding a lock keeps holding it until the
 * work has actually stopped — which is what makes a mutex around this safe.
 *
 * Once the deadline has fired the call REJECTS with `TimeoutError`, however
 * `fn` eventually settles. A deadline that accepted a late success would be no
 * deadline at all for the implementations it is meant to bound.
 *
 * The contract this places on `fn`: observe the signal. Every adapter, the Jev
 * client and every sleep in this package do. An implementation that ignores it
 * will stall its caller rather than silently overlapping the next one, which is
 * the failure mode we want — a stall is visible and restartable, whereas
 * overlapping cycles quietly double-write the feed.
 */
export async function withAbortTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: AbortTimeoutOptions,
): Promise<T> {
  const { ms, label, parent, onTimeout } = options;
  const controller = new AbortController();
  const timeoutError = new TimeoutError(label, ms);

  const timer = setTimeout(() => {
    controller.abort(timeoutError);
    // A throwing callback here would be an uncaught exception on the timer
    // macrotask — i.e. process death on a diagnostics path. Never worth it.
    try {
      onTimeout?.();
    } catch (err) {
      console.error(`[abort] onTimeout for ${label} threw:`, err);
    }
  }, ms);
  const unlink = forwardAbort(parent, controller);

  let result: T;
  try {
    result = await fn(controller.signal);
  } catch (err) {
    // `fn` surfaces the abort in whatever shape its runtime chose — fetch throws
    // a DOMException named AbortError, pg throws nothing at all. Report the
    // deadline as the deadline, but only when the deadline is what fired: a
    // parent abort (shutdown) must keep its own reason.
    //
    // `cause` matters: if `fn` ignored the deadline and later failed for a real
    // reason ("Connection terminated"), relabelling it "timed out" would throw
    // away the only evidence of what actually broke.
    if (controller.signal.reason === timeoutError) {
      if (err !== timeoutError && timeoutError.cause === undefined) {
        timeoutError.cause = err;
      }
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    unlink();
  }

  // `fn` settled successfully — but settling is not the same as beating the
  // deadline. A stage that ignores its signal and returns at 40s under a 5s
  // deadline has produced the result of a cycle that was already abandoned:
  // downstream stages would run against it, rows would be written, and the log
  // would read as a clean poll. That makes the deadline toothless against
  // exactly the implementations it exists to bound, and hides the fact that a
  // stage is ignoring cancellation at all.
  //
  // Awaiting real settlement first is still what keeps a mutex around this
  // safe; the deadline decides the OUTCOME, the operation decides the TIMING.
  //
  // Only a timeout converts a late success into a failure. A parent abort keeps
  // resolving, because "shutdown asked us to stop and the work finished anyway"
  // is a completed unit of work worth reporting as done. When the parent is
  // itself a deadline, its own wrapper applies this same rule one level up, so
  // nothing slips through.
  if (controller.signal.reason === timeoutError) throw timeoutError;
  return result;
}
