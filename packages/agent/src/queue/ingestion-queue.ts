import { Queue } from "bullmq";
import type { RawItem } from "../sources/types.js";

export interface QueueConfig {
  redisUrl?: string;
  prefix?: string;
}

export function parseRedisUrl(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || "6379", 10),
    ...(url.password ? { password: url.password } : {}),
    ...(url.username && url.username !== "default" ? { username: url.username } : {}),
  };
}

export function createIngestionQueue(config: QueueConfig = {}): Queue<RawItem[]> {
  const redisUrl = config.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";

  return new Queue<RawItem[]>("ingestion", {
    connection: parseRedisUrl(redisUrl),
    prefix: config.prefix ?? "nexus",
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
}

export async function enqueueItems(
  queue: Queue<RawItem[]>,
  items: RawItem[],
  priority: number = 0,
): Promise<void> {
  if (items.length === 0) return;

  // Batch into chunks of 50 to amortize system prompt cost across more items
  const batchSize = 50;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await queue.add("process-batch", batch, {
      priority,
    });
  }
}
