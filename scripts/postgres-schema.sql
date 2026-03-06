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

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mutation_op JSONB NOT NULL,
  before_state JSONB,
  after_state JSONB,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT
);

CREATE TABLE IF NOT EXISTS moderation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mutation_op JSONB NOT NULL,
  confidence FLOAT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_raw_items_source_url ON raw_items(source_url);
CREATE INDEX IF NOT EXISTS idx_raw_items_ingested_at ON raw_items(ingested_at);
CREATE INDEX IF NOT EXISTS idx_raw_items_arxiv_id ON raw_items((raw_metadata->>'arxiv_id'));
CREATE INDEX IF NOT EXISTS idx_audit_log_applied_at ON audit_log(applied_at);
CREATE INDEX IF NOT EXISTS idx_moderation_queue_status ON moderation_queue(status);
