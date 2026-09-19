This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

  ## Project Overview

  **Nexus** — A Jev-powered AI news feed. Two subsystems:
  1. **Agent pipeline** — ingests, dedupes, and classifies AI news items using a single Jev (TypeSafe System One) call per item, then writes them to Postgres
  2. **Feed client** — reverse-chronological feed with filters, plus a guarded extractive chat search, using React + Vite

  ## Architecture

  Sources → dedup.ts → PostgreSQL raw_items → Jev enrichment (TypeSafe System One) → PostgreSQL feed_items → Fastify API → React feed client

  Four layers: Ingestion → Enrichment (Jev) → Storage (PostgreSQL) → Presentation (feed client)

  ## Monorepo Structure

  packages/
    shared/    — TypeScript interfaces, enums, constants, validation (imported by all packages)
    agent/     — Ingestion adapters + dedup engine + Jev enrichment
    api/       — Fastify REST server (feed + chat)
    client/    — React feed UI (Vite)
  scripts/
    export-graph.ts    — One-time Neo4j → JSON archive dump (pre-decommission)
    backfill-feed.ts   — One-time historical backfill of the archive into feed_items

  TypeScript end-to-end. pnpm workspaces.

  ## Build & Dev Commands

  ```bash
  pnpm install                    # install all dependencies
  pnpm -r build                   # build all packages
  pnpm --filter <package> dev     # dev server for a specific package (e.g. client, api)
  pnpm --filter <package> test    # run tests for a specific package
  pnpm --filter <package> test -- --grep "pattern"  # run a single test by name
  docker compose up               # start PostgreSQL
  ```

  ## Key Data Model (packages/shared)

  - `RawItem`: source, source_url, title, content, published_at, raw_metadata — the deduped intake row (`raw_items` table)
  - `FeedItem`: id, title, url, source, published_at, excerpt, vertical, event_type, significance (0.0–1.0) — the enriched, published row (`feed_items` table)

  All shared types live in `packages/shared/src/types.ts`.

  ## Agent Pipeline (packages/agent)

  - **Dedup** (`dedup.ts`) — URL → title → arXiv-id → Jaccard + entity-fingerprint matching. This is the highest-value asset in the repo. **Do not rewrite it.**
  - **Jev enrichment** (`jev/enrich.ts`) — one `system_one` call per deduped `RawItem`, asking four typed questions in a single request:
    - `is_ai_relevant` (`Noul`) — item dropped if confidence < 0.6
    - `vertical` (`Choice`) — one of the 21 `Vertical` values, or `none`
    - `event_type` (`Choice`) — `launch | funding | release | acquisition | paper | update | shutdown | other`
    - `significance` (`Score`) — 5-point rubric mapped to 0.2/0.4/0.6/0.8/1.0
  - Excerpt = first 280 characters of `RawItem.content`. No LLM summary — Jev classifies, it does not generate text.
  - Insert into `feed_items` with `ON CONFLICT (url) DO NOTHING` — idempotent by design.
  - Scheduler is a `setInterval` poll loop per adapter (`POLL_INTERVAL_*` env overrides); `raw_items` is the crash-durable cursor. No queue, no Redis.
  - Source adapters implement the `SourceAdapter` interface (`poll(): Promise<RawItem[]>`).

  ## Feed Client (packages/client)

  - Full-screen reverse-chron feed: `ActivityFeed`, `FeedItem`, `FilterBar` (vertical/event_type/source chips), `HotCards` (sorted by `significance`)
  - `SearchPalette` — Fuse.js client-side search over already-loaded items
  - `ChatBox` — guarded, extractive search UI; renders returned `feed_items` as terminal-style lines, refusals as a single dim line

  ## API (packages/api)

  - Public read access, API key auth for admin/write endpoints (`middleware/auth.ts`)
  - Key endpoints:
    - `GET /api/feed` — cursor-paginated (`?cursor=<published_at,id>&limit=`), filterable by `vertical`, `event_type`, `source`, `since`
    - `GET /api/feed/meta` — counts per vertical and per event_type (drives filter chips)
    - `POST /api/chat` — guarded search: rate-limited (20 req/10min/IP, 3 strikes → 1h ban), input-validated, injection-heuristic-filtered, then one Jev classification call, then Postgres trigram search. **Chat must stay extractive — Jev classifies the query, Postgres returns real indexed rows. Never add a generative model to this path.**
    - `GET /health` — Postgres liveness probe

  ## Tech Stack

  - Database: PostgreSQL (raw_items, feed_items, pg_trgm search)
  - API: Fastify
  - Client: Vite + React
  - Search: Fuse.js (client), pg_trgm (server)
  - Agent: TypeSafe Jev (System One) — `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`, Bearer `TYPESAFE_API_KEY`
  - Deploy: Railway (Postgres + API) + Vercel (client)

  ## Important Conventions

  - Graph slugs/node IDs are gone. `feed_items` (keyed by `url`, unique) is the core table — there is no graph anymore.
  - The dedup engine (`packages/agent/src/dedup.ts`) is untouchable — don't rewrite or bypass it.
  - Chat must stay extractive: Jev classifies the query into facets, Postgres returns real rows. Never wire a generative model into `/api/chat` — that's the whole point of the guardrail design (nothing for prompt injection to talk to).
  - `TYPESAFE_API_KEY` is required for the agent (enrichment) and API (chat classification).
  - Low-relevance items (`is_ai_relevant` confidence < 0.6) are dropped, not queued for review.
  - Feed inserts are idempotent via `ON CONFLICT (url) DO NOTHING` — never assume an insert always creates a new row.
