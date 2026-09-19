-- raw_items: dedup intake cursor for the agent pipeline.
-- (audit_log / moderation_queue from scripts/postgres-schema.sql are legacy
-- pipeline tables and intentionally omitted.)

CREATE TABLE IF NOT EXISTS raw_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(50) NOT NULL,
  source_url TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  raw_metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_raw_items_source_url ON raw_items(source_url);
CREATE INDEX IF NOT EXISTS idx_raw_items_ingested_at ON raw_items(ingested_at);
CREATE INDEX IF NOT EXISTS idx_raw_items_arxiv_id ON raw_items((raw_metadata->>'arxiv_id'));
