import { HackerNewsAdapter } from "./sources/hackernews.js";
import { ArxivAdapter } from "./sources/arxiv.js";
import { GitHubTrendingAdapter } from "./sources/github.js";
import { TwitterAdapter } from "./sources/twitter.js";
import { createPollWorker, createProcessWorker } from "./queue/workers.js";
import type { SourceAdapter } from "./sources/types.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(1);
}

// Build adapter list
const adapters: SourceAdapter[] = [
  new HackerNewsAdapter(),
  new ArxivAdapter(),
  new GitHubTrendingAdapter(),
];

const xBearerToken = process.env.X_BEARER_TOKEN;
if (xBearerToken) {
  adapters.push(new TwitterAdapter(xBearerToken));
  console.log("Twitter adapter enabled");
} else {
  console.log("Twitter adapter disabled (no X_BEARER_TOKEN)");
}

console.log(`Starting agent with ${adapters.length} adapters: ${adapters.map((a) => a.name).join(", ")}`);

// Start poll worker (fetches from sources → enqueues to Redis)
const pollWorker = createPollWorker(adapters, {
  redisUrl: process.env.REDIS_URL,
  pipelineConfig: { apiKey },
  onError: (err) => console.error("[poll]", err.message),
});

// Start process worker (dequeues from Redis → runs LLM pipeline)
const processWorker = createProcessWorker({
  redisUrl: process.env.REDIS_URL,
  pipelineConfig: { apiKey },
  onResult: (result) => {
    console.log(
      `[pipeline] relevant=${result.triageResult.relevant.length} rejected=${result.triageResult.rejected.length} ` +
      `valid=${result.validMutations.length} invalid=${result.invalidMutations.length}`,
    );
  },
  onError: (err) => console.error("[pipeline]", err.message),
});

await pollWorker.start();
console.log("Poll worker started");
console.log("Process worker started");

// Graceful shutdown
const shutdown = async () => {
  console.log("Shutting down...");
  pollWorker.stop();
  await processWorker.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
