import neo4jDriver from "neo4j-driver";
import pg from "pg";
import { HackerNewsAdapter } from "./sources/hackernews.js";
import { ArxivAdapter } from "./sources/arxiv.js";
import { GitHubTrendingAdapter } from "./sources/github.js";
import { TwitterAdapter } from "./sources/twitter.js";
import { createPollWorker, createProcessWorker } from "./queue/workers.js";
import { applyMutations } from "./mutations/engine.js";
import type { SourceAdapter } from "./sources/types.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(1);
}

// Neo4j connection
const neo4jUri = process.env.NEO4J_URI ?? "bolt://localhost:7687";
const neo4jAuth = process.env.NEO4J_AUTH;

let auth;
if (neo4jAuth === "none" || neo4jAuth === "") {
  auth = undefined;
} else if (neo4jAuth && neo4jAuth.includes("/")) {
  const [user, ...rest] = neo4jAuth.split("/");
  auth = neo4jDriver.auth.basic(user, rest.join("/"));
} else {
  const user = process.env.NEO4J_USER ?? "neo4j";
  const password = process.env.NEO4J_PASSWORD;
  if (!password) {
    console.error("NEO4J_PASSWORD (or NEO4J_AUTH) must be set");
    process.exit(1);
  }
  auth = neo4jDriver.auth.basic(user, password);
}

const driver = neo4jDriver.driver(neo4jUri, auth);

// PostgreSQL connection for dedup
const databaseUrl = process.env.DATABASE_URL;
const pgPool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;
if (pgPool) {
  console.log("PostgreSQL dedup enabled");
} else {
  console.log("PostgreSQL dedup disabled (no DATABASE_URL)");
}

// Verify Neo4j connection
try {
  const session = driver.session();
  await session.run("RETURN 1");
  await session.close();
  console.log("Neo4j connected");
} catch (err) {
  console.error("Neo4j connection failed:", err instanceof Error ? err.message : err);
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

console.log(
  `Starting agent with ${adapters.length} adapters: ${adapters.map((a) => a.name).join(", ")}`,
);

// Start poll worker (fetches from sources → enqueues to Redis)
const pollWorker = createPollWorker(adapters, {
  redisUrl: process.env.REDIS_URL,
  pgPool: pgPool ?? undefined,
  pipelineConfig: { apiKey },
  onError: (err) => console.error("[poll]", err.message),
});

// Start process worker (dequeues from Redis → runs LLM pipeline → applies mutations)
const processWorker = createProcessWorker({
  redisUrl: process.env.REDIS_URL,
  pipelineConfig: { apiKey },
  onResult: async (result) => {
    console.log(
      `[pipeline] relevant=${result.triageResult.relevant.length} rejected=${result.triageResult.rejected.length} ` +
        `valid=${result.validMutations.length} invalid=${result.invalidMutations.length}`,
    );

    if (result.validMutations.length > 0) {
      const session = driver.session();
      try {
        const mutationResult = await applyMutations(result.validMutations, {
          neo4jSession: session,
        });
        console.log(
          `[mutations] applied=${mutationResult.applied} rejected=${mutationResult.rejected} ` +
            `moderated=${mutationResult.moderated} errors=${mutationResult.errors.length}`,
        );
        if (mutationResult.errors.length > 0) {
          for (const e of mutationResult.errors) {
            console.warn(`[mutations] error: ${e.error}`);
          }
        }
      } catch (err) {
        console.error("[mutations]", err instanceof Error ? err.message : err);
      } finally {
        await session.close();
      }
    }
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
  await driver.close();
  if (pgPool) await pgPool.end();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
