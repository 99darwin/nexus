/**
 * Agent entrypoint: per-adapter poll loop → dedup → raw_items → Jev → feed_items.
 *
 * No queue and no broker. `raw_items` is the crash-durable cursor: every new
 * item is recorded there before enrichment, so a restart mid-poll re-dedups
 * rather than re-enriching.
 *
 * This file is bootstrap only — the cycle mechanics live in `poll-loop.ts` so
 * they are testable without a live pg connection.
 */

import pg from "pg";
import { HackerNewsAdapter } from "./sources/hackernews.js";
import { ArxivAdapter } from "./sources/arxiv.js";
import { GitHubTrendingAdapter } from "./sources/github.js";
import { TwitterAdapter } from "./sources/twitter.js";
import { RssAdapter } from "./sources/rss.js";
import type { SourceAdapter } from "./sources/types.js";
import { JevClient } from "./jev/client.js";
import {
  PollMutex,
  SeenUrlCache,
  getIntervalForAdapter,
  pollOnce,
  type PollDeps,
} from "./poll-loop.js";
import { drainAndClosePool } from "./shutdown.js";

// ── Bootstrap ───────────────────────────────────────────────────────────

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// Throws if TYPESAFE_API_KEY is unset — fail before any polling starts.
let jev: JevClient;
try {
  jev = new JevClient();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const pgPool = new pg.Pool({ connectionString: databaseUrl });

try {
  await pgPool.query("SELECT 1");
  console.log("PostgreSQL connected");
} catch (err) {
  console.error("PostgreSQL connection failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}

const adapters: SourceAdapter[] = [
  new HackerNewsAdapter(),
  new ArxivAdapter(),
  new GitHubTrendingAdapter(),
  new RssAdapter(),
];

const xBearerToken = process.env.X_BEARER_TOKEN;
if (xBearerToken) {
  adapters.push(new TwitterAdapter(xBearerToken));
  console.log("Twitter adapter enabled");
} else {
  console.log("Twitter adapter disabled (no X_BEARER_TOKEN)");
}

console.log(
  `Starting agent with ${adapters.length} adapters: ${adapters.map((a) => a.name).join(", ")}`,
);

// ── Poll loop ───────────────────────────────────────────────────────────

/** Aborting this cancels every running cycle — the first step of shutdown. */
const shutdownController = new AbortController();
const deps: PollDeps = {
  pool: pgPool,
  client: jev,
  seenCache: new SeenUrlCache(),
  signal: shutdownController.signal,
};
/** Process-wide: cycles never overlap, so content dedup can't race itself. */
const pollMutex = new PollMutex();
const intervalIds: ReturnType<typeof setInterval>[] = [];
/** In-flight polls, awaited on shutdown so Jev calls drain before pg closes. */
const inFlight = new Set<Promise<void>>();
let isShuttingDown = false;

function schedulePoll(adapter: SourceAdapter): () => void {
  // Guards against a slow poll overlapping its own next tick, which would
  // re-enrich the same items and double the Jev spend. The mutex serializes
  // ACROSS adapters; this flag keeps a single adapter from queueing up behind
  // itself while it waits its turn.
  let isPolling = false;

  return () => {
    if (isShuttingDown) return;
    if (isPolling) {
      console.warn(`[poll:${adapter.name}] previous poll still running, skipping tick`);
      return;
    }
    isPolling = true;

    const run = pollMutex
      .run(() => pollOnce(adapter, deps))
      .catch((err) => {
        // A cycle cancelled by shutdown is the expected outcome, not a fault.
        const message = err instanceof Error ? err.message : String(err);
        if (isShuttingDown) console.log(`[poll:${adapter.name}] cancelled: ${message}`);
        else console.error(`[poll:${adapter.name}]`, message);
      })
      .finally(() => {
        isPolling = false;
        inFlight.delete(run);
      });
    inFlight.add(run);
  };
}

for (const adapter of adapters) {
  const tick = schedulePoll(adapter);
  tick(); // initial poll, not awaited — the mutex orders them
  const intervalMs = getIntervalForAdapter(adapter.name);
  intervalIds.push(setInterval(tick, intervalMs));
  console.log(`[poll:${adapter.name}] interval=${intervalMs}ms`);
}

// ── Graceful shutdown ───────────────────────────────────────────────────

let shuttingDownPromise: Promise<void> | null = null;

function shutdown(signal: string): void {
  if (shuttingDownPromise) return;
  isShuttingDown = true;
  console.log(`Shutting down (${signal})...`);

  shuttingDownPromise = (async () => {
    const { drained, poolClosed } = await drainAndClosePool({
      stopTimers: () => {
        for (const id of intervalIds) clearInterval(id);
        intervalIds.length = 0;
      },
      // Cancels in-flight fetches, Jev calls and inter-stage waits, so the
      // drain below usually completes in milliseconds rather than running the
      // remaining Jev calls to completion against the drain timeout.
      cancelCycles: () => shutdownController.abort(new Error(`shutting down (${signal})`)),
      inFlight: () => inFlight,
      closePool: () => pgPool.end(),
    });
    if (!drained || !poolClosed) {
      // An unclean exit is information the supervisor should see: a restart
      // policy that treats this as success will keep rolling a deploy that is
      // wedging a stage every time.
      console.error(`Shutdown incomplete (drained=${drained} poolClosed=${poolClosed})`);
      process.exit(1);
    }
    console.log("Shutdown complete");
    process.exit(0);
  })();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
