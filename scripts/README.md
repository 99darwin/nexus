# scripts/

## Neo4j → Postgres migration (one-time, Wave 0)

Two scripts run once, in order, before the Neo4j instance is decommissioned:

1. **`export-graph.ts`** — dumps every Neo4j `Entity` node and `RELATES_TO`
   edge to `archive/graph-export.json`, for cold-storage/archival purposes.
   Not read by the running app.
2. **`backfill-feed.ts`** — flattens every Entity's `events[]` into rows in
   the new Postgres `feed_items` table (see
   `scripts/migrations/001_feed_items.sql`), which replaces the graph as the
   primary read model for the news feed. Safe to re-run: inserts are
   `ON CONFLICT (url) DO NOTHING`.

### Required environment variables

**Neo4j** (both scripts):
- `NEO4J_URI` — defaults to `bolt://localhost:7687`.
- `NEO4J_AUTH` — either `"none"` (no auth) or `"user/password"`. If unset,
  falls back to `NEO4J_USER` (defaults to `neo4j`) + `NEO4J_PASSWORD`
  (required in that case).

**Postgres** (`backfill-feed.ts` only):
- `DATABASE_URL` — a full connection string, or:
- `POSTGRES_HOST` (default `localhost`), `POSTGRES_PORT` (default `5432`),
  `POSTGRES_DB` (default `nexus`), `POSTGRES_USER` (default `nexus`), and
  `POSTGRES_PASSWORD` (required).

### Usage

```bash
pnpm export-graph    # tsx scripts/export-graph.ts
pnpm backfill-feed   # tsx scripts/backfill-feed.ts
```

Run `001_feed_items.sql` against Postgres before `backfill-feed.ts`.
