import { useEffect, useMemo, useRef } from "react";
import type { FeedItem as FeedItemData, FeedMeta } from "../data/feed-types";
import { BUCKET_ORDER, dateBucket, type DateBucket } from "../data/time";
import { FeedItem } from "./FeedItem";
import { FilterBar } from "./FilterBar";
import { HotCards } from "./HotCards";

interface ActivityFeedProps {
  items: FeedItemData[];
  hot: FeedItemData[];
  meta: FeedMeta | null;
  status: "loading" | "ready" | "error";
  loadingMore: boolean;
  hasMore: boolean;
  hasFilters: boolean;
  activeVertical: string | null;
  activeEventType: string | null;
  markedItemId: string | null;
  /** increments on every palette selection so re-picking the same row still scrolls */
  markToken: number;
  onVerticalToggle: (vertical: string) => void;
  onEventTypeToggle: (eventType: string) => void;
  onClearFilters: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

export function ActivityFeed({
  items,
  hot,
  meta,
  status,
  loadingMore,
  hasMore,
  hasFilters,
  activeVertical,
  activeEventType,
  markedItemId,
  markToken,
  onVerticalToggle,
  onEventTypeToggle,
  onClearFilters,
  onLoadMore,
  onRetry,
}: ActivityFeedProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // items arrive reverse-chron from the api; bucket without re-sorting
  const buckets = useMemo(() => {
    const grouped = new Map<DateBucket, FeedItemData[]>();
    for (const item of items) {
      const bucket = dateBucket(item.published_at);
      const existing = grouped.get(bucket);
      if (existing) existing.push(item);
      else grouped.set(bucket, [item]);
    }
    return grouped;
  }, [items]);

  /* cmd-k selection scrolls the chosen item into view. `items` stays a dep so a
   * row that has not rendered yet still gets scrolled to once it arrives, but the
   * token guard fires at most once per selection — without it every load-more and
   * every 5-minute refresh would yank the viewport back to an old pick. */
  const lastMarkedRef = useRef(0);
  useEffect(() => {
    if (!markedItemId || lastMarkedRef.current === markToken) return;
    const target = listRef.current?.querySelector(`[data-item-id="${CSS.escape(markedItemId)}"]`);
    if (!(target instanceof HTMLElement)) return; // not loaded yet — retry on the next page
    lastMarkedRef.current = markToken;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }, [markedItemId, markToken, items]);

  return (
    <div className="feed">
      <FilterBar
        meta={meta}
        activeVertical={activeVertical}
        activeEventType={activeEventType}
        onVerticalToggle={onVerticalToggle}
        onEventTypeToggle={onEventTypeToggle}
        onClearFilters={onClearFilters}
      />

      <HotCards items={hot} />

      <div className="feed-list" ref={listRef}>
        {/* above the rows, not below them: after a failed filter change the rows on
            screen are the *previous* query's, and a notice hundreds of rows down is
            a notice nobody reads. the live region is mounted empty and filled —
            screen readers announce changes inside a region, not a region that
            appears with its text already in place. */}
        <div role="status" aria-live="polite">
          {status === "error" && (
            <p className="status-line">
              feed unavailable —{" "}
              <button type="button" className="chip" onClick={onRetry}>
                retry
              </button>
            </p>
          )}
        </div>

        {BUCKET_ORDER.map((bucket) => {
          const bucketItems = buckets.get(bucket);
          if (!bucketItems || bucketItems.length === 0) return null;
          return (
            <section key={bucket} aria-label={bucket}>
              <h2 className="bucket-label">{bucket}</h2>
              {bucketItems.map((item) => (
                <FeedItem key={item.id} item={item} isMarked={item.id === markedItemId} />
              ))}
            </section>
          );
        })}

        {status === "loading" && items.length === 0 && <p className="status-line">loading…</p>}

        {status === "ready" && items.length === 0 && (
          <p className="status-line">
            {hasFilters ? "no items match these filters" : "no items indexed yet"}
          </p>
        )}

        {hasMore && (
          <button type="button" className="load-more" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? "loading…" : "load more"}
          </button>
        )}
      </div>
    </div>
  );
}
