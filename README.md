# Nexus

**A Jev-powered AI news feed.**

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Docker](https://img.shields.io/badge/Docker-Compose-blue)

Nexus ingests AI news from multiple sources, dedupes it, classifies each item with a single [Jev](https://typesafe.ai) (TypeSafe System One) call, and serves the result as a reverse-chronological feed with filters and a guarded, extractive chat search. No graph database, no generative LLM in the request path.

```
Sources (arxiv, hackernews, github, twitter, rss)
   │
   ▼
dedup.ts (URL → title → arXiv-id → Jaccard + entity fingerprints)
   │
   ▼
PostgreSQL raw_items
   │
   ▼
Jev enrichment (TypeSafe System One, model jev-latest, 1 call/item)
   relevant? (Noul) · vertical (Choice) · event_type (Choice) · significance (Score)
   │
   ▼
PostgreSQL feed_items (reverse-chron, indexed)
   │
   ▼
Fastify API — GET /api/feed · GET /api/feed/meta · POST /api/chat
   │
   ▼
React feed client — ActivityFeed, FilterBar, HotCards, guarded ChatBox
```

## Quick Start

```bash
# 1. Start infrastructure (PostgreSQL)
docker compose up -d

# 2. Install dependencies
pnpm install

# 3. Build all packages
pnpm build

# 4. Start API and client dev servers (separate terminals)
pnpm dev:api
pnpm dev:client

# 5. Run the agent (source polling + Jev enrichment) separately
pnpm --filter @nexus/agent start
```

The client opens at `http://localhost:5173` and the API serves at `http://localhost:3001`.

## Monorepo Layout

| Package | Path | Description |
|---------|------|-------------|
| `@nexus/shared` | `packages/shared` | TypeScript interfaces, enums, constants, validation — imported by all packages |
| `@nexus/agent` | `packages/agent` | Source adapters + dedup + Jev enrichment |
| `@nexus/api` | `packages/api` | Fastify REST server for the feed and chat search |
| `@nexus/client` | `packages/client` | React feed UI (Vite) |

## Adding a Source Adapter

The primary contribution path is adding new data sources. Every adapter feeds raw items into the dedup + Jev enrichment pipeline, which classifies and inserts them into the feed automatically.

### The `RawItem` Interface

```typescript
// packages/agent/src/sources/types.ts
interface RawItem {
  source: string;        // adapter name, e.g. "arxiv"
  source_url: string;    // canonical URL for deduplication
  title: string;         // headline / paper title
  content: string;       // body text (Jev classifies, excerpt is sliced from here)
  published_at: string;  // ISO 8601 timestamp
  raw_metadata: Record<string, unknown>; // source-specific fields
}
```

### Write Your Adapter

Extend `BaseAdapter` and implement `fetchItems()`. You get rate limiting, exponential retry with backoff, and URL-based deduplication for free.

```typescript
// packages/agent/src/sources/my-source.ts
import type { RawItem } from "./types.js";
import { BaseAdapter } from "./base-adapter.js";

export class MySourceAdapter extends BaseAdapter {
  name = "my-source";
  priority = "P1" as const;

  constructor() {
    super({
      pollIntervalMs: 30 * 60 * 1000, // how often to poll
      rateLimitMs: 2000,               // min delay between requests
    });
  }

  protected async fetchItems(): Promise<RawItem[]> {
    const response = await fetch("https://api.example.com/items");
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

    const data = await response.json();
    return this.dedupeByUrl(
      data.map((item: any) => ({
        source: this.name,
        source_url: item.url,
        title: item.title,
        content: item.body,
        published_at: new Date(item.date).toISOString(),
        raw_metadata: { id: item.id },
      }))
    );
  }
}
```

### Existing Adapters

| Adapter | Source | Priority | Poll Interval | Auth |
|---------|--------|----------|---------------|------|
| `ArxivAdapter` | arXiv RSS (cs.AI, cs.CL, cs.LG) | P0 | 30 min | None |
| `HackerNewsAdapter` | HN Algolia API | P0 | 15 min | None |
| `GitHubTrendingAdapter` | GitHub Search API | P0 | 60 min | Optional `GITHUB_TOKEN` |
| `TwitterAdapter` | X/Twitter API v2 | P1 | 15 min | `X_BEARER_TOKEN` required |
| `RssAdapter` | Company blogs, TechCrunch AI, The Verge AI, Simon Willison | P1 | 2h (default) | None |

### Register Your Adapter

1. Add your adapter to the adapter list in `packages/agent/src/start.ts`:

```typescript
import { MySourceAdapter } from "./sources/my-source.js";

const adapters: SourceAdapter[] = [
  new HackerNewsAdapter(),
  new ArxivAdapter(),
  new GitHubTrendingAdapter(),
  new MySourceAdapter(),          // add here
];
```

2. Write a test in `packages/agent/src/sources/__tests__/` following existing patterns.

3. Run tests: `pnpm --filter @nexus/agent test`

## Jev Enrichment

Every deduped `RawItem` gets exactly one call to TypeSafe's System One API (`POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`, Bearer `TYPESAFE_API_KEY`). Jev is a decision model — it answers typed questions (`Noul`, `Choice`, `Score`) against structured JSON, it does not generate text. One call answers all four questions for an item:

- `is_ai_relevant` (`Noul`) — dropped if confidence < 0.6
- `vertical` (`Choice`) — one of the 21 `Vertical` values, or `none`
- `event_type` (`Choice`) — `launch | funding | release | acquisition | paper | update | shutdown | other`
- `significance` (`Score`) — a 5-point rubric mapped to 0.2–1.0

The excerpt shown in the feed is the first 280 characters of the source content — never an LLM summary, so it can't hallucinate.

## Chat Search

`POST /api/chat` is a guarded, extractive search box, not a chatbot. It classifies the query with one Jev call (on-topic check, vertical/event-type/timeframe extraction), then returns real rows from `feed_items` via Postgres trigram search. There is no generative model anywhere in the chat path — there's nothing for a prompt injection to talk to.

## Data Model

### `feed_items`

`id` (uuid) · `title` · `url` (unique) · `source` · `published_at` · `excerpt` · `vertical` · `event_type` · `significance` (0.0–1.0) · `created_at`

### Verticals

21 spatial-cluster categories, defined in `packages/shared/src/types.ts` (e.g. `foundation_models`, `agents`, `safety_alignment`, `consumer_products`, ...).

### Event Types

`launch` | `funding` | `release` | `acquisition` | `paper` | `update` | `shutdown` | `other`

## Contributing

1. Fork the repo and create a branch: `feat/my-feature`, `fix/some-bug`, or `chore/cleanup`
2. Write conventional commit messages: `feat: add devto adapter`, `fix: handle empty RSS feed`
3. Run checks before opening a PR:

```bash
pnpm test          # run all tests
pnpm lint          # eslint
pnpm typecheck     # tsc --noEmit
```

4. Keep PRs focused — one adapter or feature per PR.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TYPESAFE_API_KEY` | Yes | — | TypeSafe API key for Jev (System One) enrichment and chat classification |
| `POSTGRES_HOST` | No | `localhost` | PostgreSQL host |
| `POSTGRES_PORT` | No | `5432` | PostgreSQL port |
| `POSTGRES_DB` | No | `nexus` | PostgreSQL database name |
| `POSTGRES_USER` | No | `nexus` | PostgreSQL user |
| `POSTGRES_PASSWORD` | Yes | — | PostgreSQL password |
| `X_BEARER_TOKEN` | No | — | X/Twitter API bearer token (enables Twitter adapter) |
| `GITHUB_TOKEN` | No | — | GitHub PAT (raises rate limits for GitHub adapter) |
| `API_KEY` | No | — | API key for write/admin endpoints |
| `API_PORT` | No | `3001` | API server port |
| `API_HOST` | No | `0.0.0.0` | API server bind address |
| `CLIENT_PORT` | No | `5173` | Client dev server port |

## Tech Stack

- **Database** — PostgreSQL 16 (`raw_items`, `feed_items`, pg_trgm search)
- **API** — Fastify
- **Client** — Vite + React
- **Search** — Fuse.js (client-side, loaded items), pg_trgm (server, chat + feed search)
- **Agent** — TypeSafe Jev (System One) for enrichment and chat classification
- **Deploy** — Railway (Postgres + API) + Vercel (client)

## Cost

Enrichment is roughly 1 Jev call per new deduped item, at ~50–100 items/day across all sources, plus 1 Jev call per chat query. There is no Neo4j, no Redis, and no generative LLM anywhere in the pipeline — that's the entire compute bill.

## License

[MIT](LICENSE)
