// Uniqueness constraint on Entity ID
CREATE CONSTRAINT entity_id_unique IF NOT EXISTS
FOR (n:Entity) REQUIRE n.id IS UNIQUE;

// Indexes for common query patterns
CREATE INDEX entity_type IF NOT EXISTS FOR (n:Entity) ON (n.type);
CREATE INDEX entity_vertical IF NOT EXISTS FOR (n:Entity) ON (n.vertical);
CREATE INDEX entity_status IF NOT EXISTS FOR (n:Entity) ON (n.status);
CREATE INDEX entity_significance IF NOT EXISTS FOR (n:Entity) ON (n.significance);
CREATE INDEX entity_updated_at IF NOT EXISTS FOR (n:Entity) ON (n.updated_at);

// Full-text search index on name + summary
CREATE FULLTEXT INDEX entity_search IF NOT EXISTS
FOR (n:Entity) ON EACH [n.name, n.summary];
