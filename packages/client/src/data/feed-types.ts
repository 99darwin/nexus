/* flat feed shapes for the UI — salvaged from the deleted graph/types.ts.
 * Structurally identical to `FeedItem` in @nexus/shared; declared locally so the
 * client builds standalone (it has no workspace dependency on the shared package). */

export interface FeedItem {
  id: string;
  title: string;
  url: string;
  source: string;
  published_at: string;
  excerpt: string | null;
  vertical: string | null;
  event_type: string | null;
  significance: number | null;
}

const isNullableString = (value: unknown): boolean => value == null || typeof value === "string";

/** Row-level shape guard — api rows are untrusted, and a malformed one that
 * reaches render (e.g. `null` in `items`) unmounts the whole tree. The optional
 * fields are checked too: an object in `excerpt` renders as a React child and
 * throws, and a number in `vertical` reaches `.replace()` in `verticalLabel`. */
export function isFeedItem(value: unknown): value is FeedItem {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.title === "string" &&
    typeof row.url === "string" &&
    typeof row.source === "string" &&
    typeof row.published_at === "string" &&
    isNullableString(row.excerpt) &&
    isNullableString(row.vertical) &&
    isNullableString(row.event_type) &&
    (row.significance == null ||
      (typeof row.significance === "number" && Number.isFinite(row.significance)))
  );
}

/** GET /api/feed */
export interface FeedPage {
  items: FeedItem[];
  next_cursor: string | null;
}

/** GET /api/feed/meta */
export interface FeedMeta {
  verticals: Record<string, number>;
  event_types: Record<string, number>;
  total: number;
}

/** POST /api/chat — facets Jev read out of the question */
export interface ChatInterpretation {
  vertical: string | null;
  event_type: string | null;
  timeframe: string | null;
}

/** Normalized POST /api/chat outcome. The route answers with items, a refusal,
 * or a 429; network/upstream failures collapse into `error`. */
export type ChatResult =
  | { kind: "items"; items: FeedItem[]; interpreted: ChatInterpretation }
  | { kind: "refusal"; refusal: string }
  | { kind: "rate_limited"; retryAfterMs: number }
  | { kind: "error" };

export interface FeedQuery {
  vertical?: string | null;
  event_type?: string | null;
  source?: string | null;
  since?: string | null;
  q?: string | null;
  cursor?: string | null;
  limit?: number;
}
