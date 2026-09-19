-- Full-text search over feed_items. Replaces the pg_trgm similarity path:
-- short queries score ~0.03 against long title+excerpt text under plain
-- similarity(), below any usable % threshold. A stored tsvector + GIN keeps
-- the search indexed; FTS also stems, which chat queries need.

ALTER TABLE feed_items
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || coalesce(excerpt, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_feed_items_search_tsv ON feed_items USING GIN (search_tsv);
