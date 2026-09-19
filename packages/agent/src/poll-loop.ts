/**
 * Poll-cycle mechanics, extracted from `start.ts` so they can be tested without
 * the bootstrap's side effects (pg connection, process.exit, signal handlers).
 *
 * The pipeline per cycle: poll → url/title dedup → content dedup → record to
 * raw_items → Jev enrich → feed_items.
 */

import { withAbortTimeout } from "./abort.js";
import type { RawItem, SourceAdapter } from "./sources/types.js";
import {
  deduplicateItems,
  recordItems,
  addContentFingerprints,
  deduplicateByContent,
} from "./dedup.js";
import type { JevClient } from "./jev/client.js";
import { enrichItems } from "./jev/enrich.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = any;

// ── Poll interval resolution ────────────────────────────────────────────

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export const ADAPTER_DEFAULTS: Record<string, number> = {
  hackernews: EIGHT_HOURS_MS,
  arxiv: TWENTY_FOUR_HOURS_MS,
  github: EIGHT_HOURS_MS,
  twitter: EIGHT_HOURS_MS,
  rss: SIX_HOURS_MS,
};

export const MIN_POLL_INTERVAL_MS = 60_000;
/**
 * Upper bound on a poll interval. Node stores timer delays in a signed 32-bit
 * int: anything above 2_147_483_647 overflows, and `setInterval` then fires
 * every 1 ms while printing TimeoutOverflowWarning — turning a fat-fingered env
 * var into a continuous Jev bill. 7 days is far below that ceiling and is
 * already longer than any sane feed interval, so the cap is a product decision
 * rather than a bare overflow guard.
 */
export const MAX_POLL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const FALLBACK_INTERVAL_MS = TWO_HOURS_MS;

/**
 * Parse an interval override strictly. `parseInt` is the wrong tool here: it
 * happily returns 60000 for "60000garbage" and 6 for "6e9", so a typo silently
 * becomes a valid-looking interval. Only an unsigned run of digits is accepted.
 */
export function parsePollIntervalMs(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  // Bounded digit run: 15 digits cannot overflow Number.MAX_SAFE_INTEGER.
  if (!/^\d{1,15}$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) return null;
  if (parsed < MIN_POLL_INTERVAL_MS || parsed > MAX_POLL_INTERVAL_MS) return null;
  return parsed;
}

export function getIntervalForAdapter(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  // One `hasOwn` gate covering BOTH the env read and the default lookup.
  //
  // It has to come first, because a plain-object index reaches the prototype:
  // `ADAPTER_DEFAULTS["constructor"]` returns the Object *function*, `??` keeps
  // it (a function is not nullish), and `setInterval(tick, Object)` coerces to
  // NaN — which Node runs at ~1 ms, i.e. a continuous Jev bill. Gating here
  // means every later lookup is an own property, so it is always a number.
  // It also keeps env reads to the five real adapter names.
  if (!Object.hasOwn(ADAPTER_DEFAULTS, name)) return FALLBACK_INTERVAL_MS;

  const override = parsePollIntervalMs(env[`POLL_INTERVAL_${name.toUpperCase()}_MS`]);
  if (override !== null) return override;

  return ADAPTER_DEFAULTS[name] ?? FALLBACK_INTERVAL_MS;
}

// ── In-process URL cache ────────────────────────────────────────────────

export class SeenUrlCache {
  private static readonly MAX_SIZE = 50_000;
  private seen = new Map<string, number>();

  constructor(private readonly ttlMs = 3 * 60 * 60 * 1000) {}

  /**
   * Read-only: marking happens in `markSeen`, after the item is durable.
   *
   * Marking here instead would lose items. The per-poll cap slices off the
   * overflow with a "rest next poll" note, but a filter that already marked
   * those URLs makes that a lie — they would be suppressed for the whole TTL
   * and never recorded. Same for a cycle that throws after this point.
   */
  filter(items: RawItem[]): RawItem[] {
    return items.filter((item) => !this.seen.has(item.source_url));
  }

  /** Mark URLs as handled. Call only once the outcome is durable in pg. */
  markSeen(items: RawItem[]): void {
    const now = Date.now();
    for (const item of items) this.seen.set(item.source_url, now);
    this.evictOverflow();
  }

  /**
   * Hard cap, enforced on insert.
   *
   * `prune` alone cannot bound this: it only drops entries past the TTL, so a
   * source emitting more than MAX_SIZE *fresh* URLs inside one TTL window grows
   * the map without limit — and `filter` is a per-item lookup over it on every
   * poll. Map preserves insertion order, so the oldest key is the first one.
   */
  private evictOverflow(): void {
    while (this.seen.size > SeenUrlCache.MAX_SIZE) {
      const oldest = this.seen.keys().next();
      if (oldest.done === true) return;
      this.seen.delete(oldest.value);
    }
  }

  prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [url, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(url);
    }
  }
}

// ── Serialization ───────────────────────────────────────────────────────

/**
 * Run poll cycles strictly one at a time, process-wide.
 *
 * Content dedup is read-then-write against `raw_items`: `deduplicateByContent`
 * SELECTs the recent window, and `recordItems` only writes afterwards. Two
 * adapters polling concurrently can therefore both read the window before
 * either writes, so the same story arriving under two different URLs passes
 * both times and lands as two `feed_items` rows — `ON CONFLICT (url)` cannot
 * collapse them, because the URLs genuinely differ.
 *
 * Serializing the cycles closes that window: the second adapter's SELECT runs
 * after the first adapter's INSERT has committed. At 6-24h poll intervals
 * concurrency buys nothing, so this costs no throughput that matters.
 *
 * (The alternative — an atomic claim via `INSERT … ON CONFLICT DO NOTHING
 * RETURNING` — keys on `raw_items.source_url`, the only unique constraint
 * available, and so cannot detect the different-URL case that is precisely the
 * bug. A content-keyed claim would need a unique index on a fingerprint column,
 * i.e. a migration, which lives outside this package.)
 *
 * The exclusion is only as good as `task`'s settlement: a task that resolves
 * while its work continues hands the next cycle a lock over work still running.
 * `pollOnce` is what upholds that end of the contract — it cancels on deadline
 * and waits for the cycle to genuinely stop before resolving.
 */
export class PollMutex {
  private chain: Promise<void> = Promise.resolve();

  run(task: () => Promise<void>): Promise<void> {
    // Chain onto both settle paths — a rejected predecessor must not wedge the
    // queue or swallow the next cycle.
    const next = this.chain.then(task, task);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

// ── Poll cycle ──────────────────────────────────────────────────────────

/** Cap items enriched per poll — one Jev call per item is the whole compute bill. */
export const MAX_ITEMS_PER_POLL = 30;

/**
 * Hard ceiling on what one `adapter.poll()` may hand back, and on the size of
 * each field, applied before anything else touches the items.
 *
 * MAX_ITEMS_PER_POLL is applied much later — after url dedup, content
 * fingerprinting and two pg round trips — because it caps the *Jev bill*. That
 * leaves the stages in between sized by the upstream: a compromised or
 * malfunctioning feed returning 500k items would be cached, normalized,
 * fingerprinted (O(n) shingling per item) and passed to pg as one giant array
 * parameter before the cap ever ran. These ceilings bound that work instead.
 *
 * They are far above any real feed, so they are a blast radius limit rather
 * than a throttle: tripping one means the upstream is broken or hostile.
 */
export const MAX_ITEMS_PER_FETCH = 2_000;
export const MAX_URL_CHARS = 2_048;
export const MAX_TITLE_CHARS = 1_000;
export const MAX_CONTENT_CHARS = 100_000;

/** Drop individually oversized items and cap the batch. Never throws: one bad
 *  item should cost that item, not the poll. */
export function clampFetchedItems(items: RawItem[], adapterName: string): RawItem[] {
  const capped = items.length > MAX_ITEMS_PER_FETCH ? items.slice(0, MAX_ITEMS_PER_FETCH) : items;
  if (capped.length !== items.length) {
    console.warn(
      `[poll:${adapterName}] adapter returned ${items.length} items; ` +
        `truncated to ${MAX_ITEMS_PER_FETCH}`,
    );
  }

  const kept = capped.filter(
    (item) =>
      typeof item.source_url === "string" &&
      item.source_url.length > 0 &&
      item.source_url.length <= MAX_URL_CHARS &&
      (item.title?.length ?? 0) <= MAX_TITLE_CHARS &&
      (item.content?.length ?? 0) <= MAX_CONTENT_CHARS,
  );
  if (kept.length !== capped.length) {
    console.warn(`[poll:${adapterName}] dropped ${capped.length - kept.length} oversized items`);
  }
  return kept;
}
export const ENRICH_BATCH_SIZE = 15;
export const ENRICH_CALL_DELAY_MS = 250;

/** Budget for one adapter's network fetch. */
export const ADAPTER_POLL_TIMEOUT_MS = 60_000;
/** Budget for a whole cycle, enrichment included. */
export const POLL_CYCLE_TIMEOUT_MS = 10 * 60 * 1000;
/**
 * How long after a cycle's deadline we wait before calling the stall loud.
 *
 * Reaching this means some stage ignored its AbortSignal. The mutex is still
 * held — correctly, see `pollOnce` — so ingestion is stopped until restart, and
 * that should not be something an operator has to infer from silence.
 */
export const ABORT_SETTLE_GRACE_MS = 30_000;

export interface PollDeps {
  pool: PgPool;
  client: JevClient;
  seenCache: SeenUrlCache;
  maxItemsPerPoll?: number;
  enrichBatchSize?: number;
  enrichCallDelayMs?: number;
  adapterPollTimeoutMs?: number;
  pollCycleTimeoutMs?: number;
  /** Aborting this cancels the cycle — used by shutdown to drain quickly. */
  signal?: AbortSignal;
}

/**
 * Run one cycle under a deadline, and do not resolve until it has really stopped.
 *
 * The earlier version raced the cycle against a timer. That freed the mutex
 * while the cycle was still running: the abandoned cycle would resume, overlap
 * its successor, and reintroduce the cross-adapter dedup race the mutex exists
 * to prevent — plus `pgPool.end()` could then fire mid-query during shutdown.
 *
 * Now the deadline aborts a signal that every stage observes (adapter fetch,
 * Jev request, each inter-stage boundary) and we await the cycle's own
 * settlement. Cancellation and lock release became the same event instead of
 * two events a timer apart.
 */
export async function pollOnce(adapter: SourceAdapter, deps: PollDeps): Promise<void> {
  return await withStallWatchdog((signal) => runPollCycle(adapter, deps, signal), {
    ms: deps.pollCycleTimeoutMs ?? POLL_CYCLE_TIMEOUT_MS,
    label: `poll:${adapter.name}`,
    parent: deps.signal,
  });
}

/**
 * `withAbortTimeout` plus a watchdog for work that ignores its cancellation.
 *
 * Awaiting genuine settlement is what makes the mutex honest, but it also means
 * a stage that never observes its signal stalls the queue with nothing in the
 * log to say so. Every deadline in the cycle gets one of these, not just the
 * outer one: a hung adapter is then reported against ITS OWN deadline — one
 * grace period after the stage's 60s, rather than after the whole cycle's
 * budget, or never at all if it returns just before the cycle expires.
 *
 * The watchdog is armed only once the deadline has fired, so a healthy stage
 * never allocates a timer, and it is `unref`'d so it can't by itself hold the
 * process open.
 */
async function withStallWatchdog<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: { ms: number; label: string; parent?: AbortSignal },
): Promise<T> {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    return await withAbortTimeout(fn, {
      ...options,
      onTimeout: () => {
        watchdog = setTimeout(() => {
          console.error(
            `[${options.label}] still running ${ABORT_SETTLE_GRACE_MS}ms after abort — ` +
              `it is ignoring its AbortSignal; ingestion is stalled until restart`,
          );
        }, ABORT_SETTLE_GRACE_MS);
        watchdog.unref?.();
      },
    });
  } finally {
    if (watchdog !== undefined) clearTimeout(watchdog);
  }
}

async function runPollCycle(
  adapter: SourceAdapter,
  deps: PollDeps,
  signal: AbortSignal,
): Promise<void> {
  const { pool, client, seenCache } = deps;
  const maxItems = deps.maxItemsPerPoll ?? MAX_ITEMS_PER_POLL;

  seenCache.prune();

  // Inner deadline: a slow feed should not consume the whole cycle budget.
  // Nested inside the cycle signal, so either can cancel the fetch.
  const fetched = await withStallWatchdog((fetchSignal) => adapter.poll(fetchSignal), {
    ms: deps.adapterPollTimeoutMs ?? ADAPTER_POLL_TIMEOUT_MS,
    label: `poll:${adapter.name} fetch`,
    parent: signal,
  });
  // Before the cache, the fingerprinter, or pg sees any of it.
  const items = clampFetchedItems(fetched, adapter.name);
  let newItems = seenCache.filter(items);

  // `pool.query` takes no signal (node-postgres has no such API), so the checks
  // sit at the stage boundaries: an aborted cycle finishes the dedup stage it is
  // already inside — `deduplicateItems` issues several SELECTs and checks
  // nothing between them — then stops before entering another stage or writing
  // anything. Read-only overrun is acceptable; the guarantee that matters is
  // that no WRITE happens after the abort, and that is the third check below.
  if (newItems.length > 0) {
    signal.throwIfAborted();
    const before = newItems.length;
    newItems = await deduplicateItems(newItems, pool);
    if (before !== newItems.length) {
      console.log(`[poll:${adapter.name}] pg-dedup removed=${before - newItems.length}`);
    }
  }

  if (newItems.length > 0) {
    signal.throwIfAborted();
    newItems = addContentFingerprints(newItems);
    const before = newItems.length;
    newItems = await deduplicateByContent(newItems, pool);
    if (before !== newItems.length) {
      console.log(`[poll:${adapter.name}] content-dedup removed=${before - newItems.length}`);
    }
  }

  console.log(
    `[poll:${adapter.name}] fetched=${items.length} new=${newItems.length} deduped=${items.length - newItems.length}`,
  );
  if (newItems.length === 0) {
    // Everything was deduped away, which means it is already durable in
    // raw_items — safe to suppress without another pg round trip next poll.
    seenCache.markSeen(items);
    return;
  }

  // Cap BEFORE recording. recordItems is the dedup cursor, so anything written
  // to raw_items is never fetched again — recording more than we enrich would
  // silently strand the overflow. Capping first also bounds how much untrusted
  // feed content a single poll can write.
  const overflowUrls = new Set<string>();
  if (newItems.length > maxItems) {
    console.log(`[poll:${adapter.name}] capping ${newItems.length} → ${maxItems} (rest next poll)`);
    for (const item of newItems.slice(maxItems)) overflowUrls.add(item.source_url);
    newItems = newItems.slice(0, maxItems);
  }

  // Record before enriching — this is the durable cursor, so a crash mid-enrich
  // costs the enrichment, not a duplicate re-ingest. It is also what makes the
  // serialized next cycle see these items.
  //
  // Last exit before the first write: past here the cycle would rather finish
  // recording than leave raw_items half-written.
  signal.throwIfAborted();
  await recordItems(newItems, pool);

  // Only now is suppression safe. Items dropped by pg/content dedup are already
  // durable in raw_items, so they are marked too; the capped overflow is
  // deliberately NOT marked, so "rest next poll" actually holds.
  const recorded = new Set(newItems.map((i) => i.source_url));
  const deduped = items.filter(
    (i) => !recorded.has(i.source_url) && !overflowUrls.has(i.source_url),
  );
  seenCache.markSeen([...newItems, ...deduped]);

  try {
    const stats = await enrichItems(newItems, {
      client,
      pool,
      batchSize: deps.enrichBatchSize ?? ENRICH_BATCH_SIZE,
      callDelayMs: deps.enrichCallDelayMs ?? ENRICH_CALL_DELAY_MS,
      signal,
    });
    console.log(
      `[enrich:${adapter.name}] enriched=${stats.enriched} inserted=${stats.inserted} ` +
        `dropped=${stats.droppedIrrelevant} failed=${stats.failed}`,
    );
  } catch (err) {
    // An abort here strands items. `recordItems` has already committed them to
    // raw_items, which is the dedup cursor — so the next cycle dedups them away
    // and they never get classified. A crash has the same effect, but shutdown
    // makes it a routine path, and silence would leave no way to find them.
    // Re-throw regardless: the cycle must still settle as cancelled.
    if (signal.aborted) {
      console.error(
        `[enrich:${adapter.name}] cancelled mid-enrichment — ` +
          `${newItems.length} item(s) are durable in raw_items but absent from feed_items ` +
          `and will NOT be retried: ${newItems.map((i) => i.source_url).join(" ")}`,
      );
    }
    throw err;
  }
}
