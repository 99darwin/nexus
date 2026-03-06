# Nexus

**Real-time 3D knowledge graph mapping the AI ecosystem.**

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![Neo4j](https://img.shields.io/badge/Neo4j-5-green)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Docker](https://img.shields.io/badge/Docker-Compose-blue)

Nexus ingests AI news from multiple sources, classifies entities and relationships using a multi-stage LLM pipeline (Haiku &rarr; Sonnet &rarr; Opus), and renders the result as an interactive 3D force-directed graph you can explore through time.

```
Sources ──► BullMQ/Redis ──► Agent (Claude API) ──► Mutation Engine ──► Neo4j ──► Fastify API ──► 3D Client
                                                          │
                                                     PostgreSQL
                                                   (audit + raw content)
```

## Quick Start

```bash
# 1. Start infrastructure (Neo4j, PostgreSQL, Redis)
docker compose up -d

# 2. Install dependencies
pnpm install

# 3. Build all packages
pnpm build

# 4. Seed the graph with 50 curated nodes
pnpm seed

# 5. Start API and client dev servers (separate terminals)
pnpm dev:api
pnpm dev:client
```

The client opens at `http://localhost:5173` and the API serves at `http://localhost:3000`.

## Monorepo Layout

| Package | Path | Description |
|---------|------|-------------|
| `@nexus/shared` | `packages/shared` | TypeScript interfaces, enums, constants, validation — imported by all packages |
| `@nexus/agent` | `packages/agent` | Source adapters + 3-stage LLM processing pipeline (triage/extract/recalibrate) |
| `@nexus/api` | `packages/api` | Fastify REST + WebSocket server for graph data and real-time mutation streaming |
| `@nexus/client` | `packages/client` | 3D force-directed graph visualization (Vite + React + Three.js) |

## Adding a Source Adapter

The primary contribution path is adding new data sources. Every adapter feeds raw items into the LLM pipeline, which handles entity extraction and graph mutations automatically.

### The `RawItem` Interface

```typescript
// packages/agent/src/sources/types.ts
interface RawItem {
  source: string;        // adapter name, e.g. "arxiv"
  source_url: string;    // canonical URL for deduplication
  title: string;         // headline / paper title
  content: string;       // body text for LLM extraction
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

## Data Model

### Node Types

`model` | `product` | `company` | `paper` | `person` | `framework` | `dataset` | `benchmark` | `standard` | `initiative`

### Edge (Relationship) Types

`built_on` | `competes_with` | `forked_from` | `integrates_with` | `acquired_by` | `funded_by` | `authored_by` | `benchmarked_on` | `succeeded_by` | `part_of` | `inspired_by` | `partners_with`

### ID Convention

Node IDs are deterministic slugs in `company/product` format:

```
anthropic/claude-4    openai/gpt-4o    meta/llama-3
```

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
| `ANTHROPIC_API_KEY` | Yes | — | Claude API key for the agent pipeline |
| `NEO4J_URI` | No | `bolt://localhost:7687` | Neo4j connection URI |
| `NEO4J_AUTH` | No | — | Neo4j auth in `user/password` format (set to `none` to disable) |
| `NEO4J_USER` | No | `neo4j` | Neo4j username (used if `NEO4J_AUTH` is not set) |
| `NEO4J_PASSWORD` | Yes* | — | Neo4j password (*required unless `NEO4J_AUTH` is set) |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL for BullMQ |
| `POSTGRES_URL` | No | — | PostgreSQL connection URL for audit logs |
| `X_BEARER_TOKEN` | No | — | X/Twitter API bearer token (enables Twitter adapter) |
| `GITHUB_TOKEN` | No | — | GitHub PAT (raises rate limits for GitHub adapter) |
| `API_KEY` | No | — | API key for write endpoints |

## Tech Stack

- **Graph DB** — Neo4j 5 (Cypher)
- **Metadata DB** — PostgreSQL 16 (audit logs, raw content)
- **Queue** — BullMQ on Redis 7
- **API** — Fastify + @fastify/websocket
- **Client** — Vite + React + 3d-force-graph + Three.js
- **Search** — fuse.js (client), pg_trgm (server)
- **Agent** — @anthropic-ai/sdk with Haiku/Sonnet/Opus routing
- **Deploy** — Docker Compose &rarr; GCP Cloud Run

## License

[MIT](LICENSE)
