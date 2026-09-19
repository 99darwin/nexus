/**
 * One-time backfill: flattens every Neo4j Entity's events[] into a row in
 * the new Postgres `feed_items` table (see scripts/migrations/001_feed_items.sql).
 *
 * Run once, after 001_feed_items.sql has been applied and before the Neo4j
 * instance is decommissioned. Safe to re-run: inserts are
 * ON CONFLICT (url) DO NOTHING.
 *
 * Required env:
 *   Neo4j:    NEO4J_URI (defaults to bolt://localhost:7687) and either
 *             NEO4J_AUTH ("none" or "user/password") or NEO4J_USER + NEO4J_PASSWORD.
 *   Postgres: DATABASE_URL, or POSTGRES_HOST/PORT/DB/USER + POSTGRES_PASSWORD.
 *
 * Usage: tsx scripts/backfill-feed.ts
 */
import neo4j, { type Driver, type ManagedTransaction } from "neo4j-driver";
import pg from "pg";

const { Pool } = pg;

// Page size for the SKIP/LIMIT sweep over all nodes.
const NODE_PAGE_SIZE = 500;
// Rows per Postgres INSERT batch.
const INSERT_BATCH_SIZE = 200;
// Sensible display length for a feed title; full text is preserved in excerpt.
const TITLE_MAX_LENGTH = 200;

// ── Result shapes (subset of the Neo4j Entity properties this script reads) ──

interface NodeEventResult {
  timestamp: string;
  event_type: string;
  summary: string;
  source_url: string;
}

interface NodeResult {
  id: string;
  name: string;
  vertical: string;
  significance: number;
  events: NodeEventResult[];
}

interface FeedItemRow {
  title: string;
  url: string;
  source: string;
  published_at: string;
  excerpt: string | null;
  vertical: string | null;
  event_type: string | null;
  significance: number | null;
}

// ── Connection setup ──

function createNeo4jDriver(): Driver {
  const uri = process.env.NEO4J_URI ?? "bolt://localhost:7687";
  const neo4jAuth = process.env.NEO4J_AUTH;

  let auth;
  if (neo4jAuth === "none" || neo4jAuth === "") {
    auth = undefined;
  } else if (neo4jAuth && neo4jAuth.includes("/")) {
    const [user, ...rest] = neo4jAuth.split("/");
    auth = neo4j.auth.basic(user, rest.join("/"));
  } else {
    const user = process.env.NEO4J_USER ?? "neo4j";
    const password = process.env.NEO4J_PASSWORD;
    if (!password) {
      throw new Error(
        "Missing Neo4j credentials: set NEO4J_AUTH (e.g. 'neo4j/password' or 'none') " +
          "or NEO4J_USER + NEO4J_PASSWORD before running backfill-feed.ts.",
      );
    }
    auth = neo4j.auth.basic(user, password);
  }

  console.log(`[backfill-feed] connecting to Neo4j at ${redactUri(uri)}`);
  return neo4j.driver(uri, auth);
}

function createPostgresPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    console.log("[backfill-feed] connecting to Postgres via DATABASE_URL");
    return new Pool({ connectionString, max: 5 });
  }

  if (!process.env.POSTGRES_PASSWORD) {
    throw new Error(
      "Missing Postgres credentials: set DATABASE_URL or POSTGRES_PASSWORD " +
        "(plus optional POSTGRES_HOST/PORT/DB/USER) before running backfill-feed.ts.",
    );
  }

  const host = process.env.POSTGRES_HOST ?? "localhost";
  const port = parseInt(process.env.POSTGRES_PORT ?? "5432", 10);
  const database = process.env.POSTGRES_DB ?? "nexus";
  console.log(`[backfill-feed] connecting to Postgres at ${host}:${port}/${database}`);

  return new Pool({
    host,
    port,
    database,
    user: process.env.POSTGRES_USER ?? "nexus",
    password: process.env.POSTGRES_PASSWORD,
    max: 5,
  });
}

// Strips any embedded userinfo (bolt://user:pass@host) before logging a URI.
function redactUri(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return "<unparseable NEO4J_URI>";
  }
}

function safeParse(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseNode(raw: Record<string, unknown>): NodeResult {
  return {
    ...raw,
    events: safeParse(raw.events, []),
  } as NodeResult;
}

async function fetchAllNodes(tx: ManagedTransaction): Promise<NodeResult[]> {
  const nodes: NodeResult[] = [];
  let offset = 0;

  for (;;) {
    const result = await tx.run(
      `MATCH (n:Entity)
       RETURN properties(n) as props
       ORDER BY n.id
       SKIP $offset LIMIT $limit`,
      { offset: neo4j.int(offset), limit: neo4j.int(NODE_PAGE_SIZE) },
    );

    const page = result.records.map((r) => parseNode(r.get("props")));
    nodes.push(...page);

    if (page.length < NODE_PAGE_SIZE) break;
    offset += NODE_PAGE_SIZE;
  }

  return nodes;
}

// ── Flattening ──

function deriveSource(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

interface TitleExcerpt {
  title: string;
  excerpt: string | null;
}

// Derives the display title and, when the full summary had to be truncated
// to fit the title, a separate excerpt preserving the untruncated text.
// When the summary already fits within TITLE_MAX_LENGTH, title and excerpt
// would be identical, so excerpt is left null to avoid storing a duplicate.
function deriveTitleAndExcerpt(node: NodeResult, event: NodeEventResult): TitleExcerpt {
  const summary = event.summary?.trim();
  const headline = summary && summary.length > 0 ? summary : `${node.name} — ${event.event_type}`;
  const title = truncate(headline, TITLE_MAX_LENGTH);
  const excerpt = headline.length > TITLE_MAX_LENGTH ? headline : null;
  return { title, excerpt };
}

// Accepts only non-empty strings that parse as a valid date, matching the
// strictness we already apply to source_url.
function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

interface FlattenStats {
  seen: number;
  skippedNoUrl: number;
  skippedBadUrl: number;
  skippedBadTimestamp: number;
}

function flattenNodes(nodes: NodeResult[]): { rows: FeedItemRow[]; stats: FlattenStats } {
  const rows: FeedItemRow[] = [];
  const stats: FlattenStats = {
    seen: 0,
    skippedNoUrl: 0,
    skippedBadUrl: 0,
    skippedBadTimestamp: 0,
  };

  for (const node of nodes) {
    for (const event of node.events ?? []) {
      stats.seen += 1;

      const url = event.source_url?.trim();
      if (!url) {
        stats.skippedNoUrl += 1;
        continue;
      }

      let source: string;
      try {
        source = deriveSource(url);
      } catch {
        stats.skippedBadUrl += 1;
        continue;
      }

      if (!isValidTimestamp(event.timestamp)) {
        stats.skippedBadTimestamp += 1;
        continue;
      }

      const { title, excerpt } = deriveTitleAndExcerpt(node, event);

      rows.push({
        title,
        url,
        source,
        published_at: event.timestamp,
        excerpt,
        vertical: node.vertical || null,
        event_type: event.event_type || null,
        significance: typeof node.significance === "number" ? node.significance : null,
      });
    }
  }

  return { rows, stats };
}

// Collapses rows sharing the same url (e.g. the same source_url attached to
// events on multiple Entity nodes) to one row, keeping the first occurrence.
// Without this, a within-run duplicate would either violate the (url)
// uniqueness that ON CONFLICT relies on being per-row, or get silently
// skipped by the database and misreported as "already present from a prior
// run" rather than "duplicate within this run".
function dedupeByUrl(rows: FeedItemRow[]): { rows: FeedItemRow[]; duplicatesInRun: number } {
  const seenUrls = new Set<string>();
  const deduped: FeedItemRow[] = [];
  let duplicatesInRun = 0;

  for (const row of rows) {
    if (seenUrls.has(row.url)) {
      duplicatesInRun += 1;
      continue;
    }
    seenUrls.add(row.url);
    deduped.push(row);
  }

  return { rows: deduped, duplicatesInRun };
}

// ── Insertion ──

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function insertBatch(pool: pg.Pool, rows: FeedItemRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const columns = [
    "title",
    "url",
    "source",
    "published_at",
    "excerpt",
    "vertical",
    "event_type",
    "significance",
  ];
  const values: unknown[] = [];
  const valuePlaceholders = rows.map((row, rowIndex) => {
    const placeholders = columns.map((_, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`);
    values.push(
      row.title,
      row.url,
      row.source,
      row.published_at,
      row.excerpt,
      row.vertical,
      row.event_type,
      row.significance,
    );
    return `(${placeholders.join(", ")})`;
  });

  const query = `
    INSERT INTO feed_items (${columns.join(", ")})
    VALUES ${valuePlaceholders.join(", ")}
    ON CONFLICT (url) DO NOTHING
    RETURNING id
  `;

  const result = await pool.query(query, values);
  return result.rowCount ?? 0;
}

// ── Main ──

async function main(): Promise<void> {
  const driver = createNeo4jDriver();
  const session = driver.session();
  const pool = createPostgresPool();

  try {
    await driver.verifyConnectivity();
    await pool.query("SELECT 1");

    console.log("[backfill-feed] fetching nodes from Neo4j...");
    // Single read transaction so the node set reflects one consistent
    // snapshot even if the source graph is still being ingested.
    const nodes = await session.executeRead((tx) => fetchAllNodes(tx));
    console.log(`[backfill-feed] fetched ${nodes.length} nodes`);

    const { rows, stats } = flattenNodes(nodes);
    console.log(
      `[backfill-feed] flattened ${stats.seen} events -> ${rows.length} candidate rows ` +
        `(skipped ${stats.skippedNoUrl} with no source_url, ${stats.skippedBadUrl} with an unparseable url, ` +
        `${stats.skippedBadTimestamp} with an unparseable timestamp)`,
    );

    const { rows: dedupedRows, duplicatesInRun } = dedupeByUrl(rows);
    if (duplicatesInRun > 0) {
      console.log(
        `[backfill-feed] collapsed ${duplicatesInRun} duplicate url(s) seen within this run ` +
          `(same source_url on multiple entities) to their first occurrence`,
      );
    }

    let inserted = 0;
    for (const batch of chunk(dedupedRows, INSERT_BATCH_SIZE)) {
      inserted += await insertBatch(pool, batch);
    }
    const skippedExisting = dedupedRows.length - inserted;

    console.log(
      `[backfill-feed] done: inserted ${inserted}, skipped ${skippedExisting} url(s) already present ` +
        `in feed_items from a prior run`,
    );
  } finally {
    await session.close();
    await driver.close();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const includeStack = process.env.DEBUG === "1";
  const message =
    err instanceof Error ? (includeStack ? (err.stack ?? err.message) : err.message) : String(err);
  console.error(`[backfill-feed] failed: ${message}`);
  process.exit(1);
});
