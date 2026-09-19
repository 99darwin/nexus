/* thin fetch layer over the feed api. no state, no react. */

import { isFeedItem } from "./feed-types";
import type { ChatResult, FeedMeta, FeedPage, FeedQuery } from "./feed-types";

/* in a production build an unset VITE_API_URL must fall back to the page origin —
 * localhost:3001 would only ever resolve on the developer's own machine. only the
 * origin is honoured: every endpoint path below is absolute, so a configured path
 * prefix ("https://host/v1") would be dropped by `new URL` regardless. */
function resolveApiBase(): string {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      /* not a url at all — fall through */
    }
    console.warn(`VITE_API_URL is not an absolute http(s) origin, ignoring: ${configured}`);
  }
  return import.meta.env.PROD ? window.location.origin : "http://localhost:3001";
}

const API_BASE = resolveApiBase();

export const MAX_CHAT_INPUT_LENGTH = 500;

function buildUrl(path: string, params?: Record<string, string | undefined | null>): string {
  const url = new URL(path, API_BASE);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

/** a server that accepts the socket but never answers must not leave the feed
 * stuck on "loading…" or the load-more button disabled forever */
const FEED_TIMEOUT_MS = 15_000;

function withDeadline(signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(FEED_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal: withDeadline(signal) });
  if (!response.ok) throw new Error(`api ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchFeed(query: FeedQuery = {}, signal?: AbortSignal): Promise<FeedPage> {
  const url = buildUrl("/api/feed", {
    cursor: query.cursor,
    limit: query.limit?.toString(),
    vertical: query.vertical,
    event_type: query.event_type,
    source: query.source,
    since: query.since,
    q: query.q,
  });
  const page = await getJson<{ items?: unknown; next_cursor?: unknown }>(url, signal);
  const rows = Array.isArray(page.items) ? page.items.filter(isFeedItem) : [];
  return {
    items: rows,
    next_cursor: typeof page.next_cursor === "string" ? page.next_cursor : null,
  };
}

/** counts land in the filter chips as react children — anything non-numeric would
 * throw there, so the record is rebuilt from the entries that are actually counts */
function countRecord(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) return {};
  // fromEntries defines own properties, so a "__proto__" key from the api lands
  // as data rather than hitting the prototype setter
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, count]) => typeof count === "number" && Number.isFinite(count),
    ),
  ) as Record<string, number>;
}

export async function fetchFeedMeta(signal?: AbortSignal): Promise<FeedMeta> {
  const meta = await getJson<Record<string, unknown>>(buildUrl("/api/feed/meta"), signal);
  return {
    verticals: countRecord(meta.verticals),
    event_types: countRecord(meta.event_types),
    total: typeof meta.total === "number" && Number.isFinite(meta.total) ? meta.total : 0,
  };
}

const DEFAULT_RETRY_MS = 60_000;
/** a server that accepts the socket but never answers must not wedge the composer */
const CHAT_TIMEOUT_MS = 15_000;
/** the retry window is server-supplied; cap it so a bogus value can't render as hours */
const MAX_RETRY_MS = 60 * 60_000;

/** Never throws — every failure mode is a `ChatResult` the transcript can render. */
export async function postChat(message: string): Promise<ChatResult> {
  let response: Response;
  try {
    response = await fetch(buildUrl("/api/chat"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: message.slice(0, MAX_CHAT_INPUT_LENGTH) }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
  } catch {
    return { kind: "error" };
  }

  if (response.status === 429) {
    const body = await response.json().catch(() => ({}) as Record<string, unknown>);
    const retry = (body as { retryAfterMs?: unknown }).retryAfterMs;
    const usable = typeof retry === "number" && Number.isFinite(retry) && retry > 0;
    return {
      kind: "rate_limited",
      retryAfterMs: usable ? Math.min(retry, MAX_RETRY_MS) : DEFAULT_RETRY_MS,
    };
  }

  if (!response.ok) return { kind: "error" };

  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object") return { kind: "error" };

  const refusal = (body as { refusal?: unknown }).refusal;
  if (typeof refusal === "string" && refusal.length > 0) return { kind: "refusal", refusal };

  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return { kind: "error" };

  const interpreted = ((body as { interpreted?: unknown }).interpreted ?? {}) as Record<
    string,
    unknown
  >;
  return {
    kind: "items",
    items: items.filter(isFeedItem),
    interpreted: {
      vertical: typeof interpreted.vertical === "string" ? interpreted.vertical : null,
      event_type: typeof interpreted.event_type === "string" ? interpreted.event_type : null,
      timeframe: typeof interpreted.timeframe === "string" ? interpreted.timeframe : null,
    },
  };
}
