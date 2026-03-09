import { Worker } from "bullmq";
import type { RawItem, SourceAdapter } from "../sources/types.js";
import { createIngestionQueue, enqueueItems, parseRedisUrl } from "./ingestion-queue.js";
import type { PipelineConfig } from "../pipeline.js";
import { runPipeline } from "../pipeline.js";
import {
  deduplicateItems,
  recordItems,
  addContentFingerprints,
  deduplicateByContent,
} from "../dedup.js";

const PRIORITY_MAP: Record<string, number> = { P0: 0, P1: 5, P2: 10 };

class SeenUrlCache {
  private static readonly MAX_SIZE = 50_000;
  private seen = new Map<string, number>();
  private ttlMs: number;

  constructor(ttlMs = 3 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  filter(items: RawItem[]): RawItem[] {
    if (this.seen.size > SeenUrlCache.MAX_SIZE) this.prune();
    const now = Date.now();
    return items.filter((item) => {
      if (this.seen.has(item.source_url)) return false;
      this.seen.set(item.source_url, now);
      return true;
    });
  }

  prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [url, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(url);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = any;

export interface WorkerConfig {
  redisUrl?: string;
  pgPool?: PgPool;
  pipelineConfig: PipelineConfig;
  onResult?: (result: Awaited<ReturnType<typeof runPipeline>>) => void;
  onError?: (error: Error) => void;
}

export function createPollWorker(
  adapters: SourceAdapter[],
  config: WorkerConfig,
): { start: () => Promise<void>; stop: () => void } {
  const queue = createIngestionQueue({ redisUrl: config.redisUrl });
  const seenCache = new SeenUrlCache();
  let intervalIds: ReturnType<typeof setInterval>[] = [];

  return {
    async start() {
      for (const adapter of adapters) {
        const pollFn = async () => {
          try {
            seenCache.prune();
            const items = await adapter.poll();
            let newItems = seenCache.filter(items);

            // Persistent PostgreSQL dedup (URL + title + arXiv ID)
            if (config.pgPool && newItems.length > 0) {
              const beforeDedup = newItems.length;
              newItems = await deduplicateItems(newItems, config.pgPool);
              if (beforeDedup !== newItems.length) {
                console.log(
                  `[poll:${adapter.name}] pg-dedup removed=${beforeDedup - newItems.length}`,
                );
              }
            }

            // Content-similarity dedup (within-batch + against recent DB items)
            if (config.pgPool && newItems.length > 0) {
              newItems = addContentFingerprints(newItems);
              const beforeContent = newItems.length;
              newItems = await deduplicateByContent(newItems, config.pgPool);
              if (beforeContent !== newItems.length) {
                console.log(
                  `[poll:${adapter.name}] content-dedup removed=${beforeContent - newItems.length}`,
                );
              }
            }

            console.log(
              `[poll:${adapter.name}] fetched=${items.length} new=${newItems.length} deduped=${items.length - newItems.length}`,
            );
            if (newItems.length > 0) {
              // Record items in PostgreSQL before enqueue so future polls dedup against them
              if (config.pgPool) {
                await recordItems(newItems, config.pgPool);
              }
              await enqueueItems(queue, newItems, PRIORITY_MAP[adapter.priority]);
            }
          } catch (err) {
            config.onError?.(err instanceof Error ? err : new Error(String(err)));
          }
        };

        // Initial poll
        await pollFn();

        // Schedule recurring polls
        const intervalMs = getIntervalForAdapter(adapter.name);
        intervalIds.push(setInterval(pollFn, intervalMs));
      }
    },
    stop() {
      for (const id of intervalIds) clearInterval(id);
      intervalIds = [];
    },
  };
}

export function createProcessWorker(config: WorkerConfig): Worker<RawItem[]> {
  const redisUrl = config.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";

  return new Worker<RawItem[]>(
    "ingestion",
    async (job) => {
      const items = job.data;
      try {
        const result = await runPipeline(items, config.pipelineConfig);
        config.onResult?.(result);
        return result;
      } catch (err) {
        config.onError?.(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    },
    {
      connection: parseRedisUrl(redisUrl),
      prefix: "nexus",
      concurrency: 1,
      limiter: {
        max: 5,
        duration: 1000,
      },
    },
  );
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const ADAPTER_DEFAULTS: Record<string, number> = {
  hackernews: TWO_HOURS_MS,
  arxiv: TWENTY_FOUR_HOURS_MS,
  github: TWO_HOURS_MS,
  twitter: TWO_HOURS_MS,
};

const MIN_POLL_INTERVAL_MS = 60_000;
const FALLBACK_INTERVAL_MS = TWO_HOURS_MS;

function getIntervalForAdapter(name: string): number {
  // Only read env vars for known adapter names to prevent arbitrary env var access
  if (name in ADAPTER_DEFAULTS) {
    const envKey = `POLL_INTERVAL_${name.toUpperCase()}_MS`;
    const envValue = process.env[envKey];
    if (envValue) {
      const parsed = parseInt(envValue, 10);
      if (!isNaN(parsed) && parsed >= MIN_POLL_INTERVAL_MS) return parsed;
    }
  }

  return ADAPTER_DEFAULTS[name] ?? FALLBACK_INTERVAL_MS;
}
