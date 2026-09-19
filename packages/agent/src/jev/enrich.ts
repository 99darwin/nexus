/**
 * Jev enrichment — the only classification stage in the pipeline.
 *
 * One System One call per deduped RawItem answers four typed questions
 * (relevance, vertical, event type, significance). Nothing is generated:
 * the excerpt is a literal prefix of the source content, so a hostile feed
 * can't inject text that reaches the reader as model output.
 */

import type { EventType, FeedItem, RawItem, Vertical } from "@nexus/shared";
import { VERTICALS } from "@nexus/shared";
import { sleep } from "../abort.js";
import type { ChoiceAnswer, JevClient, JevQuestion, NoulAnswer, ScoreAnswer } from "./client.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = any;

/** Below this probability on `is_ai_relevant`, the item never reaches the feed. */
export const RELEVANCE_THRESHOLD = 0.6;
export const EXCERPT_MAX_CHARS = 280;
/** Cap the content sent upstream — Jev bills on input tokens. */
const STATE_CONTENT_MAX_CHARS = 2000;

const NO_VERTICAL = "none";
const OTHER_EVENT_TYPE = "other";

/** Rubric levels, low → high. Index maps 1:1 onto SIGNIFICANCE_BY_LEVEL. */
const SIGNIFICANCE_LEVELS = [
  "minor: routine, incremental, or of interest to a narrow audience",
  "notable: worth knowing for people following the space",
  "significant: a real development most practitioners would want to see",
  "major: reshapes a product category, company, or research direction",
  "landmark: a defining moment for the AI industry",
];

const SIGNIFICANCE_BY_LEVEL = [0.2, 0.4, 0.6, 0.8, 1.0];

const EVENT_TYPE_CRITERIA: Record<string, string> = {
  launch: "a new product, service, or company is introduced",
  funding: "an investment round, raise, or valuation event",
  release: "a new version, model, or artifact ships",
  acquisition: "one company buys or merges with another",
  paper: "research publication or preprint",
  update: "an incremental change to something that already exists",
  shutdown: "a product, service, or company is discontinued",
  [OTHER_EVENT_TYPE]: "none of the above",
};

const VERTICAL_CRITERIA: Record<string, string> = {
  ...Object.fromEntries(VERTICALS.map((v) => [v.vertical, v.label])),
  [NO_VERTICAL]: "does not fit any of the above categories",
};

const QUESTIONS: Record<string, JevQuestion> = {
  is_ai_relevant: {
    type: "noul",
    instructions:
      "Is this item about the AI industry — models, companies, research, funding, products?",
    criteria: {
      true: "about AI models, AI companies, AI research, AI funding, or AI products",
      false: "unrelated to the AI industry",
    },
  },
  vertical: {
    type: "choice",
    instructions: "Which area of the AI ecosystem does this item belong to?",
    criteria: VERTICAL_CRITERIA,
  },
  event_type: {
    type: "choice",
    instructions: "What kind of event does this item report?",
    criteria: EVENT_TYPE_CRITERIA,
  },
  significance: {
    type: "score",
    instructions: "How significant is this item to the AI industry as a whole?",
    criteria: SIGNIFICANCE_LEVELS,
  },
};

const VALID_VERTICALS = new Set<string>(VERTICALS.map((v) => v.vertical));
const VALID_EVENT_TYPES = new Set<string>(
  Object.keys(EVENT_TYPE_CRITERIA).filter((k) => k !== OTHER_EVENT_TYPE),
);

/** The row shape written to `feed_items` (id/created_at are DB-assigned). */
export type FeedItemInsert = Omit<FeedItem, "id">;

export interface EnrichStats {
  enriched: number;
  inserted: number;
  droppedIrrelevant: number;
  failed: number;
}

export interface EnrichOptions {
  client: JevClient;
  pool: PgPool;
  /** Items per batch; a short pause separates batches. */
  batchSize?: number;
  /** Delay between individual Jev calls, ms. */
  callDelayMs?: number;
  /** Cancels the remaining calls, the pauses between them, and the in-flight request. */
  signal?: AbortSignal;
}

const DEFAULT_BATCH_SIZE = 15;
const DEFAULT_CALL_DELAY_MS = 250;
const BATCH_PAUSE_MULTIPLIER = 4;

/** First N chars of the source content, or null when there is nothing to show. */
export function buildExcerpt(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, EXCERPT_MAX_CHARS);
}

/** Map a fractional rubric position (0 … 4) to a 0.2–1.0 significance. */
export function significanceFromScore(score: number): number {
  if (!Number.isFinite(score)) return SIGNIFICANCE_BY_LEVEL[0];
  const index = Math.round(score);
  const clamped = Math.min(Math.max(index, 0), SIGNIFICANCE_BY_LEVEL.length - 1);
  return SIGNIFICANCE_BY_LEVEL[clamped];
}

/**
 * Classify one item. Returns the row to insert, or null when Jev judges the
 * item irrelevant to the AI industry.
 */
export async function classifyItem(
  item: RawItem,
  client: JevClient,
  signal?: AbortSignal,
): Promise<FeedItemInsert | null> {
  const state = {
    title: item.title,
    source: item.source,
    published_at: item.published_at,
    content: item.content.slice(0, STATE_CONTENT_MAX_CHARS),
  };

  const response = await client.systemOne(state, QUESTIONS, signal);
  const answers = response.answers ?? {};

  const relevance = answers.is_ai_relevant as NoulAnswer | undefined;
  // Fail closed: an absent or malformed relevance answer must not admit the item.
  // Number.isFinite, not `typeof === "number"`: typeof NaN is "number" and
  // `NaN < threshold` is false, so a NaN would sail through the gate below.
  // JSON.parse turns an overflowing literal like 1e999 into Infinity, so this
  // is reachable from a malformed upstream response, not just in theory.
  if (!relevance || !Number.isFinite(relevance.noul)) return null;
  if (relevance.noul < RELEVANCE_THRESHOLD || relevance.noul > 1) return null;

  const verticalAnswer = answers.vertical as ChoiceAnswer | undefined;
  const rawVertical = verticalAnswer?.choice;
  const vertical =
    rawVertical && VALID_VERTICALS.has(rawVertical) ? (rawVertical as Vertical) : null;

  const eventAnswer = answers.event_type as ChoiceAnswer | undefined;
  const rawEventType = eventAnswer?.choice;
  const event_type =
    rawEventType && VALID_EVENT_TYPES.has(rawEventType) ? (rawEventType as EventType) : null;

  const scoreAnswer = answers.significance as ScoreAnswer | undefined;
  const significance =
    typeof scoreAnswer?.score === "number" ? significanceFromScore(scoreAnswer.score) : null;

  return {
    title: item.title,
    url: item.source_url,
    source: item.source,
    published_at: item.published_at,
    excerpt: buildExcerpt(item.content),
    vertical,
    event_type,
    significance,
  };
}

/** Insert one enriched row. Returns false when the URL was already indexed. */
export async function insertFeedItem(row: FeedItemInsert, pool: PgPool): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO feed_items (title, url, source, published_at, excerpt, vertical, event_type, significance)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (url) DO NOTHING`,
    [
      row.title,
      row.url,
      row.source,
      row.published_at,
      row.excerpt,
      row.vertical,
      row.event_type,
      row.significance,
    ],
  );
  return (result?.rowCount ?? 0) > 0;
}

/**
 * Enrich and store a batch of deduped items. One Jev call per item; a failed
 * item is logged and skipped so a single bad response can't stall the poll.
 */
export async function enrichItems(
  items: RawItem[],
  options: EnrichOptions,
): Promise<EnrichStats> {
  const stats: EnrichStats = { enriched: 0, inserted: 0, droppedIrrelevant: 0, failed: 0 };
  if (items.length === 0) return stats;

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const callDelayMs = options.callDelayMs ?? DEFAULT_CALL_DELAY_MS;
  const { signal } = options;

  for (let i = 0; i < items.length; i += batchSize) {
    // Longer pause between batches than between calls, so a large poll spreads
    // its upstream load instead of arriving as one burst.
    if (i > 0 && callDelayMs > 0) await sleep(callDelayMs * BATCH_PAUSE_MULTIPLIER, signal);

    const batch = items.slice(i, i + batchSize);

    for (const [index, item] of batch.entries()) {
      if (index > 0 && callDelayMs > 0) await sleep(callDelayMs, signal);

      try {
        const row = await classifyItem(item, options.client, signal);
        if (!row) {
          stats.droppedIrrelevant++;
          continue;
        }
        stats.enriched++;
        // Deliberately NOT gated on `signal.aborted`. An abort between the Jev
        // call and this insert is real, but dropping the row here loses the
        // item permanently: `recordItems` already wrote it to `raw_items`, so
        // the next cycle dedups it away and never re-enriches it. The insert is
        // idempotent (`ON CONFLICT (url) DO NOTHING`) and the cycle does not
        // settle until it returns, so shutdown still closes the pool after it.
        // Cancellation stops the NEXT classification, not a paid-for write.
        if (await insertFeedItem(row, options.pool)) stats.inserted++;
      } catch (err) {
        // A per-item catch is right for a bad response — one hostile feed item
        // must not stall the poll. It is wrong for a cancellation: swallowing
        // that would keep calling Jev for a cycle nobody is waiting for, and
        // stop the cycle from ever settling. Abort ends the whole run.
        if (signal?.aborted) throw signal.reason as Error;

        stats.failed++;
        // Log the reason, never the item content or the upstream credentials.
        console.error(
          `[enrich] ${item.source}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return stats;
}
