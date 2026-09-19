-- Migration 001: feed_items
--
-- Introduces the reverse-chron news feed table that replaces the Neo4j graph
-- as the primary read model. Populated going forward by the Jev enrichment
-- stage (packages/agent) and, for history, by scripts/backfill-feed.ts.
--
-- Does NOT touch raw_items — the dedup engine (packages/agent/src/dedup.ts)
-- still reads/writes it.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS feed_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  excerpt TEXT,
  vertical TEXT,
  event_type TEXT,
  significance REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reverse-chron feed pagination (GET /api/feed)
CREATE INDEX IF NOT EXISTS idx_feed_items_published_at ON feed_items (published_at DESC);

-- Vertical filter + reverse-chron within a vertical (FilterBar chips)
CREATE INDEX IF NOT EXISTS idx_feed_items_vertical_published_at
  ON feed_items (vertical, published_at DESC);

-- Trigram search over title + excerpt (POST /api/chat facet search, GET /api/search)
CREATE INDEX IF NOT EXISTS idx_feed_items_title_excerpt_trgm
  ON feed_items USING gin ((title || ' ' || coalesce(excerpt, '')) gin_trgm_ops);
