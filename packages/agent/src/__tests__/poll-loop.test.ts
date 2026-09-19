import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RawItem, SourceAdapter } from "../sources/types.js";
import { JevClient } from "../jev/client.js";
import {
  ABORT_SETTLE_GRACE_MS,
  MAX_CONTENT_CHARS,
  MAX_ITEMS_PER_FETCH,
  MAX_POLL_INTERVAL_MS,
  MAX_TITLE_CHARS,
  MAX_URL_CHARS,
  MIN_POLL_INTERVAL_MS,
  PollMutex,
  SeenUrlCache,
  clampFetchedItems,
  getIntervalForAdapter,
  parsePollIntervalMs,
  pollOnce,
  type PollDeps,
} from "../poll-loop.js";

// ── Interval validation ─────────────────────────────────────────────────

describe("parsePollIntervalMs", () => {
  it("rejects values that overflow Node's 32-bit timer", () => {
    // Above 2^31-1 setInterval emits TimeoutOverflowWarning and then fires
    // every 1ms — a continuous Jev bill from one bad env var.
    const TIMER_MAX = 2_147_483_647;
    expect(parsePollIntervalMs(String(TIMER_MAX))).toBeNull();
    expect(parsePollIntervalMs(String(TIMER_MAX + 1))).toBeNull();
    expect(parsePollIntervalMs("999999999999")).toBeNull();

    // The cap itself is accepted, one past it is not.
    expect(parsePollIntervalMs(String(MAX_POLL_INTERVAL_MS))).toBe(MAX_POLL_INTERVAL_MS);
    expect(parsePollIntervalMs(String(MAX_POLL_INTERVAL_MS + 1))).toBeNull();
    expect(MAX_POLL_INTERVAL_MS).toBeLessThan(TIMER_MAX);
  });

  it("rejects trailing garbage that parseInt would have accepted", () => {
    // parseInt("60000garbage") === 60000 — a typo became a valid interval.
    expect(parsePollIntervalMs("60000garbage")).toBeNull();
    expect(parsePollIntervalMs("60000 60000")).toBeNull();
    expect(parsePollIntervalMs("6e9")).toBeNull(); // parseInt → 6
    expect(parsePollIntervalMs("0x7fffffff")).toBeNull();
    expect(parsePollIntervalMs("-90000")).toBeNull();
    expect(parsePollIntervalMs("90000.5")).toBeNull();
    expect(parsePollIntervalMs("")).toBeNull();
    expect(parsePollIntervalMs("   ")).toBeNull();
    expect(parsePollIntervalMs(undefined)).toBeNull();
    expect(parsePollIntervalMs("Infinity")).toBeNull();
  });

  it("enforces the 60s floor and accepts a valid override", () => {
    expect(parsePollIntervalMs(String(MIN_POLL_INTERVAL_MS - 1))).toBeNull();
    expect(parsePollIntervalMs(String(MIN_POLL_INTERVAL_MS))).toBe(MIN_POLL_INTERVAL_MS);
    expect(parsePollIntervalMs(" 90000 ")).toBe(90_000);
  });
});

describe("getIntervalForAdapter", () => {
  it("falls back to the adapter default when the override is invalid", () => {
    const def = getIntervalForAdapter("rss", {});
    expect(getIntervalForAdapter("rss", { POLL_INTERVAL_RSS_MS: "999999999999" })).toBe(def);
    expect(getIntervalForAdapter("rss", { POLL_INTERVAL_RSS_MS: "60000garbage" })).toBe(def);
    expect(getIntervalForAdapter("rss", { POLL_INTERVAL_RSS_MS: "90000" })).toBe(90_000);
  });

  it("only reads env for known adapter names", () => {
    const env = { POLL_INTERVAL_CONSTRUCTOR_MS: "90000", POLL_INTERVAL_EVIL_MS: "90000" };
    expect(getIntervalForAdapter("constructor", env)).not.toBe(90_000);
    expect(getIntervalForAdapter("evil", env)).not.toBe(90_000);
  });

  it("returns a usable number for prototype-shaped names", () => {
    // Regression: ADAPTER_DEFAULTS["constructor"] reaches Object.prototype and
    // returns the Object *function*. `??` keeps it (not nullish), and
    // setInterval(tick, Object) coerces to NaN — which Node runs at ~1ms.
    // A `.not.toBe(90_000)` assertion passes on a Function, so assert the type.
    for (const name of ["constructor", "toString", "__proto__", "valueOf", "hasOwnProperty"]) {
      const ms = getIntervalForAdapter(name, {});
      expect(typeof ms).toBe("number");
      expect(Number.isSafeInteger(ms)).toBe(true);
      expect(Number.isNaN(Number(ms))).toBe(false);
      expect(ms).toBeGreaterThanOrEqual(MIN_POLL_INTERVAL_MS);
    }
  });

  it("never returns a value that would overflow a timer", () => {
    for (const name of ["hackernews", "arxiv", "github", "twitter", "rss", "unknown"]) {
      const ms = getIntervalForAdapter(name, { [`POLL_INTERVAL_${name.toUpperCase()}_MS`]: "1e99" });
      expect(typeof ms).toBe("number");
      expect(ms).toBeGreaterThanOrEqual(MIN_POLL_INTERVAL_MS);
      expect(ms).toBeLessThanOrEqual(MAX_POLL_INTERVAL_MS);
    }
  });
});

// ── Cancellation: a deadline must cancel, not merely abandon ────────────

/** Stalls until cancelled — the shape every real adapter has once wired up. */
function makeHangingAdapter(name: string): SourceAdapter {
  return {
    name,
    priority: "P1",
    poll: (signal?: AbortSignal) =>
      new Promise<RawItem[]>((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason as Error), { once: true });
      }),
  };
}

describe("poll cancellation", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("cancels a stalled adapter fetch and lets the next adapter run", async () => {
    // Serializing cycles coupled every adapter's availability to every other
    // one, so one stalled socket must not halt all ingestion.
    const pool = makeFakePool();
    const deps = { ...makeDeps(pool), adapterPollTimeoutMs: 10 };
    const mutex = new PollMutex();

    const first = mutex
      .run(() => pollOnce(makeHangingAdapter("rss"), deps))
      .catch((e: Error) => e.message);
    const second = mutex.run(() => pollOnce(makeAdapter("hackernews", [STORY_B]), deps));

    expect(await first).toContain("timed out");
    await second;
    // The adapter behind the stalled one still ran.
    expect(pool.feedItems).toHaveLength(1);
  });

  it("reports a stalled adapter against its OWN deadline, not the cycle's", async () => {
    // The adapter stage has a 60s deadline and the cycle a much longer one. With
    // a watchdog only on the outer deadline, an adapter that ignores its signal
    // stalls silently for the whole remaining cycle budget — or forever
    // unnoticed if it returns just before the cycle expires. The log has to name
    // the stage that is actually stuck.
    vi.useFakeTimers();
    try {
      const pool = makeFakePool();
      const deps = {
        ...makeDeps(pool),
        adapterPollTimeoutMs: 10,
        pollCycleTimeoutMs: 10_000_000, // far beyond the grace period below
      };
      const deaf: SourceAdapter = {
        name: "rss",
        priority: "P1",
        poll: () => new Promise<RawItem[]>(() => {}), // ignores the signal entirely
      };

      const settled = vi.fn();
      void pollOnce(deaf, deps).then(settled, settled);

      await vi.advanceTimersByTimeAsync(10); // adapter deadline fires
      expect(settled).not.toHaveBeenCalled();
      const errors = vi.mocked(console.error);
      expect(errors).not.toHaveBeenCalled(); // grace period not yet elapsed

      await vi.advanceTimersByTimeAsync(ABORT_SETTLE_GRACE_MS);

      const logged = errors.mock.calls.map((args) => String(args[0])).join("\n");
      expect(logged).toContain("poll:rss fetch");
      expect(logged).toContain("ignoring its AbortSignal");
      // Still wedged, because the wrapper waits for genuine settlement.
      expect(settled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never runs two cycles at once when the first outlives its deadline", async () => {
    // The regression this file exists for. `Promise.race([cycle, timer])`
    // settles the WRAPPER on timeout while the cycle keeps running: the mutex
    // advanced, the abandoned cycle resumed, and two cycles were live at once —
    // exactly the cross-adapter dedup race the mutex is supposed to prevent.
    //
    // pg takes no AbortSignal, so an in-flight query is the realistic thing
    // that outlives a deadline. Concurrent in-flight queries across the two
    // pools are the measurement: >1 means two cycles were alive together.
    const store = makeStore();
    let active = 0;
    let maxActive = 0;
    const track = {
      onQueryStart: () => {
        active++;
        maxActive = Math.max(maxActive, active);
      },
      onQueryEnd: () => {
        active--;
      },
    };

    // First cycle's opening query resolves long after its 10ms deadline.
    const poolA = makeFakePool({ store, ...track, queryDelayMs: (i) => (i === 0 ? 60 : 0) });
    const poolB = makeFakePool({ store, ...track });

    const mutex = new PollMutex();
    const first = mutex
      .run(() => pollOnce(makeAdapter("rss", [STORY_A]), { ...makeDeps(poolA), pollCycleTimeoutMs: 10 }))
      .catch((e: Error) => e.message);
    const second = mutex.run(() => pollOnce(makeAdapter("hackernews", [STORY_B]), makeDeps(poolB)));

    expect(await first).toContain("timed out");
    await second;

    expect(maxActive).toBe(1);
  });

  // Settlement is not enough on its own: the cancelled cycle must also stop
  // before the durable write, or a timed-out poll still mutates the database.
  // pg takes no AbortSignal, so the guards sit at the stage boundaries — one
  // case per boundary, so each guard is independently load-bearing.
  //
  // Read-only dedup queries run first, and whichever one is slow is the one the
  // deadline lands inside. Which query sits at a given index depends on the
  // item: the arXiv-id lookup is skipped entirely when no item carries an
  // arxiv_id, so STORY_A's indices are (source_url, title, content_fp) while
  // ARXIV_STORY's are (source_url, title, arxiv_id, content_fp). Both item
  // shapes are exercised so no query is left without deadline coverage.
  //
  // Index 3 exists only for the arXiv shape. For STORY_A it is already the
  // INSERT, which is deliberately past the last exit: once recording starts the
  // cycle finishes it rather than leaving raw_items half-written.
  for (const { story, queries } of [
    { story: STORY_A, queries: [0, 1, 2] },
    { story: ARXIV_STORY, queries: [0, 1, 2, 3] },
  ]) {
    for (const slowQuery of queries) {
      it(`writes nothing when the deadline lands during ${story.source} dedup query ${slowQuery}`, async () => {
        const pool = makeFakePool({ queryDelayMs: (i) => (i === slowQuery ? 40 : 0) });
        const deps = { ...makeDeps(pool), pollCycleTimeoutMs: 10 };

        await expect(pollOnce(makeAdapter("rss", [story]), deps)).rejects.toThrow("timed out");
        // Give a cycle that ignored its cancellation time to write anyway.
        await new Promise((r) => setTimeout(r, 80));

        expect(pool.rawItems).toHaveLength(0);
        expect(pool.feedItems).toHaveLength(0);
      });
    }
  }

  it("touches the pool at all only if the deadline has not already passed", async () => {
    // An adapter can resolve normally just after the deadline. Without the
    // guard at the head of the dedup stage the cancelled cycle would still open
    // the read-then-write window it is supposed to have given up.
    const pool = makeFakePool();
    const deps = { ...makeDeps(pool), pollCycleTimeoutMs: 10 };

    const slowButOblivious: SourceAdapter = {
      name: "rss",
      priority: "P1",
      poll: () => new Promise<RawItem[]>((resolve) => setTimeout(() => resolve([STORY_A]), 40)),
    };

    await expect(pollOnce(slowButOblivious, deps)).rejects.toThrow("timed out");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("stops issuing queries once cancelled instead of finishing the dedup stages", async () => {
    // pg has no AbortSignal, so an aborted cycle finishes at most the query
    // already in flight. Every stage after that must be skipped, or a cancelled
    // cycle keeps billing the database all the way to the write.
    const pool = makeFakePool({ queryDelayMs: (i) => (i === 0 ? 40 : 0) });
    const deps = { ...makeDeps(pool), pollCycleTimeoutMs: 10 };

    await expect(pollOnce(makeAdapter("rss", [STORY_A]), deps)).rejects.toThrow("timed out");
    await new Promise((r) => setTimeout(r, 80));

    // Only the queries inside the dedup call already running when the deadline
    // hit — never the content-fingerprint read that follows it.
    const sql = pool.query.mock.calls.map(([q]) => q as string);
    expect(sql.some((q) => q.includes("content_fp"))).toBe(false);
  });

  it("propagates a shutdown abort with its own reason, not as a timeout", async () => {
    const controller = new AbortController();
    const pool = makeFakePool();
    const deps = { ...makeDeps(pool), signal: controller.signal };

    const run = pollOnce(makeHangingAdapter("rss"), deps);
    controller.abort(new Error("shutting down (SIGTERM)"));

    await expect(run).rejects.toThrow("shutting down (SIGTERM)");
  });

  it("holds the lock rather than overlapping when a stage ignores its signal", async () => {
    // The deliberate trade. Waiting for genuine settlement means an adapter
    // that ignores its AbortSignal stalls the queue instead of being abandoned.
    // A stall is loud (see ABORT_SETTLE_GRACE_MS) and a restart clears it;
    // an abandoned cycle silently double-writes the feed forever.
    const pool = makeFakePool();
    const deps = { ...makeDeps(pool), adapterPollTimeoutMs: 5, pollCycleTimeoutMs: 5 };
    const mutex = new PollMutex();

    const ignoresAbort: SourceAdapter = {
      name: "rss",
      priority: "P1",
      poll: () => new Promise<RawItem[]>(() => {}),
    };

    let secondStarted = false;
    void mutex.run(() => pollOnce(ignoresAbort, deps)).catch(() => {});
    void mutex
      .run(async () => {
        secondStarted = true;
      })
      .catch(() => {});

    await new Promise((r) => setTimeout(r, 50));
    expect(secondStarted).toBe(false);
  });
});

// ── Intake ceilings ─────────────────────────────────────────────────────

describe("clampFetchedItems", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  function item(overrides: Partial<RawItem>): RawItem {
    return { ...STORY_A, ...overrides };
  }

  it("caps a firehose before fingerprinting or pg ever sees it", () => {
    // MAX_ITEMS_PER_POLL is applied far downstream — it caps the Jev bill, not
    // the work before it. Without this ceiling a compromised feed's 500k items
    // get normalized, O(n)-shingled and passed to pg as one array parameter.
    const flood = Array.from({ length: MAX_ITEMS_PER_FETCH + 500 }, (_, i) =>
      item({ source_url: `https://x.example/${i}` }),
    );
    expect(clampFetchedItems(flood, "rss")).toHaveLength(MAX_ITEMS_PER_FETCH);
  });

  it("drops individually oversized items without failing the poll", () => {
    const kept = clampFetchedItems(
      [
        item({ source_url: `https://x.example/${"a".repeat(MAX_URL_CHARS)}` }),
        item({ source_url: "https://x.example/2", title: "t".repeat(MAX_TITLE_CHARS + 1) }),
        item({ source_url: "https://x.example/3", content: "c".repeat(MAX_CONTENT_CHARS + 1) }),
        item({ source_url: "" }),
        item({ source_url: "https://x.example/ok" }),
      ],
      "rss",
    );
    // One bad item costs that item, not the whole cycle.
    expect(kept.map((i) => i.source_url)).toEqual(["https://x.example/ok"]);
  });

  it("passes a normal batch through untouched", () => {
    const items = [STORY_A, STORY_B];
    expect(clampFetchedItems(items, "rss")).toEqual(items);
  });
});

describe("SeenUrlCache", () => {
  it("evicts oldest-first once past the hard cap, not only on TTL", () => {
    // `prune` drops TTL-expired entries only, so a source emitting more than
    // MAX_SIZE *fresh* urls inside one TTL window grew the map without bound —
    // and `filter` is a per-item lookup over it on every poll.
    const cache = new SeenUrlCache();
    const total = 50_000 + 10;
    cache.markSeen(
      Array.from({ length: total }, (_, i) => ({
        ...STORY_A,
        source_url: `https://x.example/${i}`,
      })),
    );

    const survivors = cache.filter(
      Array.from({ length: total }, (_, i) => ({
        ...STORY_A,
        source_url: `https://x.example/${i}`,
      })),
    );
    // Exactly the overflow was evicted, and it was the oldest entries.
    expect(survivors).toHaveLength(10);
    expect(survivors.map((s) => s.source_url)).toEqual(
      Array.from({ length: 10 }, (_, i) => `https://x.example/${i}`),
    );
  });
});

// ── Fixtures ────────────────────────────────────────────────────────────

interface FakeStore {
  rawItems: Array<{ source_url: string; title: string; raw_metadata: string }>;
  feedItems: Array<{ url: string; title: string }>;
}

/** A pg backing store two pools can share, so each cycle gets its own handle. */
function makeStore(): FakeStore {
  return { rawItems: [], feedItems: [] };
}

interface FakePoolOptions {
  /** Share a store between pools to model two cycles against one database. */
  store?: FakeStore;
  /** Per-query delay by call index — used to make a query outlive its deadline. */
  queryDelayMs?: (index: number) => number;
  /** In-flight query count is the observable proxy for "this cycle is alive". */
  onQueryStart?: () => void;
  onQueryEnd?: () => void;
}

/**
 * Fake pg pool modelling just enough of raw_items / feed_items: the unique
 * constraints and the read-then-write ordering the race depends on. Every query
 * yields, so two concurrent cycles genuinely interleave.
 */
function makeFakePool(options: FakePoolOptions = {}) {
  const { rawItems, feedItems } = options.store ?? makeStore();
  let calls = 0;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const delay = options.queryDelayMs?.(calls++) ?? 0;
    options.onQueryStart?.();
    try {
      return await runQuery(sql, params, delay);
    } finally {
      options.onQueryEnd?.();
    }
  });

  async function runQuery(sql: string, params: unknown[], delay: number) {
    // node-postgres takes no AbortSignal, so this deliberately ignores one:
    // an in-flight query runs to completion no matter what the cycle decides.
    await new Promise((r) => setTimeout(r, delay)); // real interleaving point

    if (sql.includes("SELECT source_url FROM raw_items")) {
      const urls = params[0] as string[];
      return { rows: rawItems.filter((r) => urls.includes(r.source_url)).map((r) => ({ source_url: r.source_url })) };
    }
    if (sql.includes("SELECT title FROM raw_items")) {
      const titles = params[0] as string[];
      return { rows: rawItems.filter((r) => titles.includes(r.title)).map((r) => ({ title: r.title })) };
    }
    if (sql.includes("arxiv_id")) return { rows: [] };
    if (sql.includes("content_fp")) {
      return {
        rows: rawItems.map((r) => {
          const meta = JSON.parse(r.raw_metadata);
          return { fp: meta.content_fp ?? [], entities: meta.title_entities ?? [] };
        }),
      };
    }
    if (sql.includes("INSERT INTO raw_items")) {
      // ON CONFLICT (source_url) DO NOTHING
      for (let i = 0; i < params.length; i += 6) {
        const source_url = params[i + 1] as string;
        if (rawItems.some((r) => r.source_url === source_url)) continue;
        rawItems.push({
          source_url,
          title: params[i + 2] as string,
          raw_metadata: params[i + 5] as string,
        });
      }
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("INSERT INTO feed_items")) {
      // ON CONFLICT (url) DO NOTHING
      const url = params[1] as string;
      if (feedItems.some((f) => f.url === url)) return { rowCount: 0, rows: [] };
      feedItems.push({ url, title: params[0] as string });
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  }

  return { query, rawItems, feedItems };
}

function makeJevClient() {
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      model: "jev-latest",
      answers: {
        is_ai_relevant: { type: "noul", noul: 0.95 },
        vertical: { type: "choice", choice: "foundation_models", probabilities: {}, confidence: 1 },
        event_type: { type: "choice", choice: "release", probabilities: {}, confidence: 1 },
        significance: { type: "score", score: 3, probabilities: {}, confidence: 1 },
      },
    }),
  }));
  return new JevClient({
    apiKey: "test-key",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    maxRetries: 0,
  });
}

function makeAdapter(name: string, items: RawItem[]): SourceAdapter {
  return { name, priority: "P1", poll: async () => items };
}

/** Same story, different URLs — the case ON CONFLICT (url) cannot collapse. */
const STORY_A: RawItem = {
  source: "rss",
  source_url: "https://site-a.example/anthropic-claude-opus",
  title: "Anthropic Releases Claude Opus Model",
  content: "Anthropic today released its newest Claude Opus model for developers.",
  published_at: "2026-09-01T00:00:00.000Z",
  raw_metadata: {},
};

const STORY_B: RawItem = {
  source: "hackernews",
  source_url: "https://site-b.example/claude-opus-ships",
  title: "Claude Opus Ships From Anthropic",
  content: "Anthropic has shipped the new Claude Opus model to developers today.",
  published_at: "2026-09-01T00:05:00.000Z",
  raw_metadata: {},
};

/**
 * An item that carries an arxiv_id, so `deduplicateItems` takes its arXiv-id
 * branch. Without one that branch is skipped entirely and the query index it
 * would occupy is silently the content-fingerprint read instead.
 */
const ARXIV_STORY: RawItem = {
  source: "arxiv",
  source_url: "https://arxiv.org/abs/2609.01234",
  title: "Scaling Laws for Sparse Mixture Models",
  content: "We study scaling behaviour in sparsely activated mixture-of-experts models.",
  published_at: "2026-09-01T00:10:00.000Z",
  raw_metadata: { arxiv_id: "2609.01234" },
};

function makeDeps(pool: ReturnType<typeof makeFakePool>): PollDeps {
  return {
    pool,
    client: makeJevClient(),
    seenCache: new SeenUrlCache(),
    enrichCallDelayMs: 0,
  };
}

// ── Cross-adapter dedup race ────────────────────────────────────────────

describe("cross-adapter dedup race", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("serialized cycles insert exactly one feed_items row for one story", async () => {
    const pool = makeFakePool();
    const deps = makeDeps(pool);
    const mutex = new PollMutex();

    const a = makeAdapter("rss", [STORY_A]);
    const b = makeAdapter("hackernews", [STORY_B]);

    // Both ticks fire in the same turn, exactly as the scheduler does.
    await Promise.all([
      mutex.run(() => pollOnce(a, deps)),
      mutex.run(() => pollOnce(b, deps)),
    ]);

    expect(pool.feedItems).toHaveLength(1);
    expect(pool.rawItems).toHaveLength(1);
  });

  it("demonstrates the race the mutex exists to prevent", async () => {
    // Guard the guard: without serialization the same input double-inserts, so
    // the test above cannot pass for some unrelated reason (e.g. content dedup
    // catching it within a single batch).
    const pool = makeFakePool();
    const deps = makeDeps(pool);

    await Promise.all([
      pollOnce(makeAdapter("rss", [STORY_A]), deps),
      pollOnce(makeAdapter("hackernews", [STORY_B]), deps),
    ]);

    expect(pool.feedItems).toHaveLength(2);
  });

  it("keeps running after a cycle throws", async () => {
    const pool = makeFakePool();
    const deps = makeDeps(pool);
    const mutex = new PollMutex();

    const boom = makeAdapter("rss", []);
    boom.poll = async () => {
      throw new Error("adapter exploded");
    };

    const failed = mutex.run(() => pollOnce(boom, deps)).catch(() => "handled");
    const after = mutex.run(() => pollOnce(makeAdapter("hackernews", [STORY_B]), deps));

    expect(await failed).toBe("handled");
    await after;
    // A rejected predecessor must not wedge the queue.
    expect(pool.feedItems).toHaveLength(1);
  });

  it("returns the capped overflow on the next poll instead of dropping it", async () => {
    // The cap logs "rest next poll". A seen-cache that marked URLs at filter
    // time made that false: the overflow was suppressed for the full 3h TTL and
    // never recorded, so those items were silently lost.
    const pool = makeFakePool();
    const deps = { ...makeDeps(pool), maxItemsPerPoll: 2 };

    // Deliberately unrelated: shared title words would trip content-dedup and
    // make this test measure the wrong thing.
    const stories: Array<[string, string]> = [
      ["Zebra Migration Patterns Shift Northward", "Researchers tracked herds across the savanna."],
      ["Quantum Bakery Opens Downtown Tuesday", "A pastry shop themed on physics began trading."],
      ["Volcano Erupts Near Reykjavik Harbour", "Lava flows prompted an evacuation of nearby homes."],
      ["Chess Champion Retires After Final Match", "The grandmaster announced an end to competition."],
      ["Coral Reef Restoration Hits Milestone", "Divers replanted thousands of fragments offshore."],
    ];
    const items: RawItem[] = stories.map(([title, content], i) => ({
      source: "rss",
      source_url: `https://site.example/story-${i}`,
      title,
      content,
      published_at: "2026-09-01T00:00:00.000Z",
      raw_metadata: {},
    }));

    const adapter = makeAdapter("rss", items);
    await pollOnce(adapter, deps);
    expect(pool.rawItems).toHaveLength(2);

    // Same adapter returns the same feed; the 3 uncapped items must get through.
    await pollOnce(adapter, deps);
    expect(pool.rawItems).toHaveLength(4);
    await pollOnce(adapter, deps);
    expect(pool.rawItems).toHaveLength(5);
  });

  it("does not suppress items when a cycle throws before recording", async () => {
    const pool = makeFakePool();
    const deps = makeDeps(pool);
    const seenCache = deps.seenCache;

    pool.query.mockRejectedValueOnce(new Error("pg down"));
    await expect(pollOnce(makeAdapter("rss", [STORY_A]), deps)).rejects.toThrow();

    // Nothing durable happened, so the URL must still be eligible next poll.
    expect(seenCache.filter([STORY_A])).toHaveLength(1);
  });

  it("runs cycles strictly one at a time", async () => {
    const mutex = new PollMutex();
    let active = 0;
    let maxActive = 0;

    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
    };

    await Promise.all([mutex.run(task), mutex.run(task), mutex.run(task)]);
    expect(maxActive).toBe(1);
  });
});
