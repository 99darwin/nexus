/* feed state — cursor pagination, facet filters, derived hot items.
 * replaces the deleted graph-store.ts (links/comparison halves dropped). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchFeed, fetchFeedMeta } from "./feed-client";
import type { FeedItem, FeedMeta } from "./feed-types";

const PAGE_SIZE = 50;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const HOT_ITEM_COUNT = 5;

export type FeedStatus = "loading" | "ready" | "error";

/**
 * Merge a freshly fetched page into the items already loaded.
 * De-dupes on `id` (the api may repeat a row across a cursor boundary when new
 * items land mid-scroll) and keeps the list reverse-chronological, so a
 * refresh of page 1 and a load-more of page N compose the same way.
 */
export function mergeItems(existing: FeedItem[], incoming: FeedItem[]): FeedItem[] {
  if (incoming.length === 0) return existing;

  const byId = new Map<string, FeedItem>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item); // incoming wins — it is fresher

  // unparseable dates collapse to 0 so the comparator stays transitive
  const stamp = (item: FeedItem): number => {
    const parsed = Date.parse(item.published_at);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  return [...byId.values()].sort((a, b) => {
    const delta = stamp(b) - stamp(a);
    if (delta !== 0) return delta;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0; // stable tiebreak, matches cursor order
  });
}

/** Top items by significance — drives the "what's hot" rail. */
export function hotItems(items: FeedItem[], limit = HOT_ITEM_COUNT): FeedItem[] {
  return [...items]
    .filter((item) => item.significance != null && Number.isFinite(item.significance))
    .sort((a, b) => (b.significance ?? 0) - (a.significance ?? 0))
    .slice(0, limit);
}

export interface FeedStore {
  items: FeedItem[];
  hot: FeedItem[];
  meta: FeedMeta | null;
  status: FeedStatus;
  loadingMore: boolean;
  hasMore: boolean;
  activeVertical: string | null;
  activeEventType: string | null;
  hasFilters: boolean;
  toggleVertical: (vertical: string) => void;
  toggleEventType: (eventType: string) => void;
  clearFilters: () => void;
  loadMore: () => void;
  retry: () => void;
}

export function useFeedStore(): FeedStore {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [meta, setMeta] = useState<FeedMeta | null>(null);
  const [status, setStatus] = useState<FeedStatus>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [activeVertical, setActiveVertical] = useState<string | null>(null);
  const [activeEventType, setActiveEventType] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // read by loadMore without re-creating the callback on every page
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = nextCursor;
  const loadingMoreRef = useRef(false);
  /* bumped whenever the query the feed is built from changes. an in-flight
   * loadMore captures it and drops its page if the epoch moved, so a filter
   * switch mid-fetch can neither merge foreign rows nor install their cursor. */
  const epochRef = useRef(0);

  // first page + periodic refresh; re-runs whenever a facet changes
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    epochRef.current += 1;
    /* false until a page for *this* query has landed. if the first page failed, the
     * rows on screen still belong to the previous query — the refresh that recovers
     * must replace them, not merge two queries' rows into one list. */
    let loadedOnce = false;

    const loadFirstPage = async (isRefresh: boolean) => {
      if (!isRefresh) setStatus("loading");
      try {
        const page = await fetchFeed(
          { vertical: activeVertical, event_type: activeEventType, limit: PAGE_SIZE },
          controller.signal,
        );
        if (cancelled) return;
        const recovering = !loadedOnce;
        loadedOnce = true;
        // a refresh merges on top of what is already scrolled; a filter change, or a
        // refresh that is the first success for this query, replaces
        setItems((prev) => (isRefresh && !recovering ? mergeItems(prev, page.items) : page.items));
        /* a later refresh never touches the cursor: a non-null one has been advanced
         * by load-more, and a null one means pagination is exhausted — re-adopting
         * page 1's cursor there would resurrect "load more" at the end of the feed. */
        setNextCursor((prev) => (isRefresh && !recovering ? prev : page.next_cursor));
        setStatus("ready");
      } catch {
        if (cancelled) return;
        if (!isRefresh) setStatus("error");
      }
    };

    void loadFirstPage(false);
    const timer = setInterval(() => void loadFirstPage(true), REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      controller.abort();
    };
  }, [activeVertical, activeEventType, reloadToken]);

  // facet counts for the chips — independent of the current page
  useEffect(() => {
    const controller = new AbortController();
    fetchFeedMeta(controller.signal)
      .then(setMeta)
      .catch(() => {
        // an abort is a teardown, not a failure — leave the counts alone
        if (!controller.signal.aborted) setMeta(null);
      });
    return () => controller.abort();
  }, [reloadToken]);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const epoch = epochRef.current;

    fetchFeed({
      cursor,
      vertical: activeVertical,
      event_type: activeEventType,
      limit: PAGE_SIZE,
    })
      .then((page) => {
        if (epoch !== epochRef.current) return; // filters moved under us
        setItems((prev) => mergeItems(prev, page.items));
        setNextCursor(page.next_cursor);
      })
      .catch(() => {
        /* keep what is already rendered; the button stays available */
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [activeVertical, activeEventType]);

  /* every facet change restarts pagination from the top — dropping the cursor
   * synchronously keeps a stale one from being replayed against new filters. */
  const toggleVertical = useCallback((vertical: string) => {
    setNextCursor(null);
    setActiveVertical((prev) => (prev === vertical ? null : vertical));
  }, []);

  const toggleEventType = useCallback((eventType: string) => {
    setNextCursor(null);
    setActiveEventType((prev) => (prev === eventType ? null : eventType));
  }, []);

  const clearFilters = useCallback(() => {
    setNextCursor(null);
    setActiveVertical(null);
    setActiveEventType(null);
  }, []);

  const retry = useCallback(() => {
    setNextCursor(null);
    setReloadToken((token) => token + 1);
  }, []);

  const hot = useMemo(() => hotItems(items), [items]);

  return {
    items,
    hot,
    meta,
    status,
    loadingMore,
    hasMore: nextCursor !== null,
    activeVertical,
    activeEventType,
    hasFilters: activeVertical !== null || activeEventType !== null,
    toggleVertical,
    toggleEventType,
    clearFilters,
    loadMore,
    retry,
  };
}
