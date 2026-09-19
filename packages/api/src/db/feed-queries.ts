/**
 * All SQL against `feed_items` lives here.
 *
 * Every value is bound as a placeholder — the only interpolated text is the
 * column list and the ORDER BY shape, both of which are compile-time
 * constants in this file.
 */

import type pg from "pg";
import type { FeedItem, Vertical, EventType } from "@nexus/shared";

const FEED_COLUMNS =
  "id, title, url, source, published_at, excerpt, vertical, event_type, significance";

/**
 * Exponential decay constant for recency scoring: 30 days in seconds. Score
 * falls to 1/e at 30 days (half-life ~20.8 days).
 */
const RECENCY_DECAY_SECONDS = 30 * 24 * 60 * 60;

/**
 * Microsecond-precision cursor key.
 *
 * `published_at` is a timestamptz, so Postgres keeps microseconds — but
 * node-postgres hands back a JS Date, which only holds milliseconds. Building
 * the cursor from that truncated Date rounds *down*, and `(published_at, id) <
 * (cursor)` then skips every row sitting in the sub-millisecond gap. Render
 * the key in SQL so the keyset round-trips losslessly.
 */
const CURSOR_KEY_COLUMN = `to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_key`;

/**
 * Trigram floor for `q` searches. The default 0.3 drops almost every
 * multi-word query, so we lower it per-transaction (see withTrigramThreshold).
 */
const SIMILARITY_FLOOR = 0.08;

/**
 * Must match the GIN index expression exactly
 * (idx_feed_items_title_excerpt_trgm, gin_trgm_ops) or the index is skipped.
 */
const TRIGRAM_HAYSTACK = "title || ' ' || coalesce(excerpt, '')";

/**
 * Index-usable match predicate. Only the `%` operator consults the GIN
 * trigram index — a bare `similarity(...) > x` comparison forces a seq scan —
 * so `%` filters and `similarity()` ranks.
 */
const matchExpr = (queryParam: string): string => `${TRIGRAM_HAYSTACK} % ${queryParam}`;

const similarityExpr = (queryParam: string): string =>
  `similarity(${TRIGRAM_HAYSTACK}, ${queryParam})`;

/**
 * `greatest(..., 0)` clamps the age floor at zero: a future-dated row would
 * otherwise get exp(positive) — an unbounded bonus that outranks everything.
 */
const RECENCY_EXPR = `exp(-greatest(extract(epoch from (now() - published_at)), 0) / ${RECENCY_DECAY_SECONDS}.0)`;

interface FeedRow {
  id: string;
  title: string;
  url: string;
  source: string;
  published_at: Date;
  excerpt: string | null;
  vertical: string | null;
  event_type: string | null;
  significance: number | string | null;
  /** Present only on queries that select CURSOR_KEY_COLUMN. */
  cursor_key?: string;
}

export function rowToFeedItem(row: FeedRow): FeedItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    source: row.source,
    published_at:
      row.published_at instanceof Date ? row.published_at.toISOString() : String(row.published_at),
    excerpt: row.excerpt,
    vertical: (row.vertical as Vertical | null) ?? null,
    event_type: (row.event_type as EventType | null) ?? null,
    significance: row.significance === null ? null : Number(row.significance),
  };
}

/**
 * Runs a `%`-filtered query with the trigram threshold lowered.
 *
 * The threshold is a GUC, so it has to be set on the same connection the
 * query runs on. `set_config(..., true)` makes it transaction-local: it
 * reverts at COMMIT and never leaks to the next borrower of this pooled
 * connection.
 */
async function withTrigramThreshold(
  pool: pg.Pool,
  sql: string,
  params: unknown[],
): Promise<FeedRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('pg_trgm.similarity_threshold', $1, true)", [
      String(SIMILARITY_FLOOR),
    ]);
    const result = await client.query<FeedRow>(sql, params);
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      /* connection is already unusable — the original error is what matters */
    });
    throw error;
  } finally {
    client.release();
  }
}

export interface FeedCursor {
  publishedAt: string;
  id: string;
}

export interface FeedQuery {
  limit: number;
  vertical?: Vertical;
  eventType?: EventType;
  source?: string;
  since?: string;
  /** Trigram search term. When set, results are relevance-ordered, not chronological. */
  q?: string;
  cursor?: FeedCursor;
}

export interface FeedPage {
  items: FeedItem[];
  /** Null when the page is the last one, or when `q` made the order unstable. */
  nextCursor: string | null;
}

/**
 * Reverse-chronological feed page, or a relevance-ordered page when `q` is
 * set. Callers are responsible for validating every field first.
 */
export async function queryFeed(pool: pg.Pool, query: FeedQuery): Promise<FeedPage> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (query.vertical) conditions.push(`vertical = ${bind(query.vertical)}`);
  if (query.eventType) conditions.push(`event_type = ${bind(query.eventType)}`);
  if (query.source) conditions.push(`source = ${bind(query.source)}`);
  if (query.since) conditions.push(`published_at >= ${bind(query.since)}::timestamptz`);

  let orderBy = "published_at DESC, id DESC";

  if (query.q) {
    const queryParam = bind(query.q);
    conditions.push(matchExpr(queryParam));
    orderBy = `${similarityExpr(queryParam)} * 0.7 + ${RECENCY_EXPR} * 0.3 DESC, published_at DESC, id DESC`;
  } else if (query.cursor) {
    // Tuple comparison keeps the keyset stable across ties on published_at.
    const ts = bind(query.cursor.publishedAt);
    const id = bind(query.cursor.id);
    conditions.push(`(published_at, id) < (${ts}::timestamptz, ${id}::uuid)`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitParam = bind(query.limit);

  const sql = `SELECT ${FEED_COLUMNS}, ${CURSOR_KEY_COLUMN}
     FROM feed_items
     ${where}
     ORDER BY ${orderBy}
     LIMIT ${limitParam}`;

  const rows = query.q
    ? await withTrigramThreshold(pool, sql, params)
    : (await pool.query<FeedRow>(sql, params)).rows;

  const items = rows.map(rowToFeedItem);

  // A relevance-ordered result set has no stable keyset, so it is a single
  // page by construction. A short page is the last page.
  //
  // Built strictly from `cursor_key`, never from the item's published_at:
  // node-postgres hands back a millisecond JS Date, and a cursor truncated down
  // to milliseconds makes the next page's keyset predicate skip whatever sat in
  // the sub-millisecond gap. No cursor is safer than a silently lossy one.
  const last = rows[rows.length - 1];
  const nextCursor =
    !query.q && last?.cursor_key && rows.length === query.limit
      ? `${last.cursor_key},${last.id}`
      : null;

  return { items, nextCursor };
}

export interface FeedMeta {
  verticals: Record<string, number>;
  event_types: Record<string, number>;
  total: number;
}

export async function queryFeedMeta(pool: pg.Pool): Promise<FeedMeta> {
  const [verticalResult, eventTypeResult, totalResult] = await Promise.all([
    pool.query<{ vertical: string; count: string }>(
      `SELECT vertical, COUNT(*) AS count
       FROM feed_items
       WHERE vertical IS NOT NULL
       GROUP BY vertical`,
    ),
    pool.query<{ event_type: string; count: string }>(
      `SELECT event_type, COUNT(*) AS count
       FROM feed_items
       WHERE event_type IS NOT NULL
       GROUP BY event_type`,
    ),
    pool.query<{ total: string }>("SELECT COUNT(*) AS total FROM feed_items"),
  ]);

  const verticals: Record<string, number> = {};
  for (const row of verticalResult.rows) verticals[row.vertical] = parseInt(row.count, 10);

  const event_types: Record<string, number> = {};
  for (const row of eventTypeResult.rows) event_types[row.event_type] = parseInt(row.count, 10);

  return {
    verticals,
    event_types,
    total: parseInt(totalResult.rows[0]?.total ?? "0", 10),
  };
}

export interface FeedSearch {
  q: string;
  limit: number;
  vertical?: Vertical;
  eventType?: EventType;
  /** Constrain to the last N days. Omit for all time. */
  withinDays?: number;
}

/**
 * Extractive search used by /api/chat: trigram relevance blended with
 * recency, constrained by the facets Jev extracted from the query.
 */
export async function searchFeedItems(pool: pg.Pool, search: FeedSearch): Promise<FeedItem[]> {
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const queryParam = bind(search.q);
  const conditions = [matchExpr(queryParam)];

  if (search.vertical) conditions.push(`vertical = ${bind(search.vertical)}`);
  if (search.eventType) conditions.push(`event_type = ${bind(search.eventType)}`);
  if (search.withinDays !== undefined) {
    conditions.push(`published_at >= now() - (${bind(search.withinDays)}::int * interval '1 day')`);
  }

  const limitParam = bind(search.limit);

  const rows = await withTrigramThreshold(
    pool,
    `SELECT ${FEED_COLUMNS}
     FROM feed_items
     WHERE ${conditions.join(" AND ")}
     ORDER BY ${similarityExpr(queryParam)} * 0.7 + ${RECENCY_EXPR} * 0.3 DESC, published_at DESC, id DESC
     LIMIT ${limitParam}`,
    params,
  );

  return rows.map(rowToFeedItem);
}
