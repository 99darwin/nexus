import { memo } from "react";
import type { FeedItem as FeedItemData } from "../data/feed-types";
import { isSafeHttpUrl, relativeTime, truncateUrl } from "../data/time";
import { nodeColor, verticalLabel } from "../theme/vertical-colors";

interface FeedItemProps {
  item: FeedItemData;
  /** cmd-k selection target — outlined and scrolled into view */
  isMarked: boolean;
}

/** `null` unless the api sent a usable 0–1 number — `undefined` and NaN both
 * render as "significance NaN%" if they reach the meter. */
function clampSignificance(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

/* memoized: the list only ever grows, so a load-more re-renders every row otherwise.
 * accepted tradeoff: the 5-minute refresh only refetches page 1, so rows below it
 * keep their identity and their `relativeTime` label goes stale in a session left
 * open for hours. those rows are old enough that the label is coarse ("2d ago"),
 * and a ticking clock in context would re-render the whole list every minute —
 * exactly what the memo is here to prevent. */
export const FeedItem = memo(function FeedItem({ item, isMarked }: FeedItemProps) {
  const safeUrl = isSafeHttpUrl(item.url);
  const significance = clampSignificance(item.significance);
  const meta = [
    item.source,
    relativeTime(item.published_at),
    verticalLabel(item.vertical),
    item.event_type, // lowercase text tag in place of the old emoji column
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className={isMarked ? "feed-item feed-item-marked" : "feed-item"}
      data-item-id={item.id}
      tabIndex={-1}
    >
      <span
        className="feed-item-swatch"
        style={{ background: nodeColor(item.vertical) }}
        aria-hidden="true"
      />
      <div className="feed-item-body">
        <h3 className="feed-item-title">
          {safeUrl ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </h3>
        <p className="feed-item-meta">{meta}</p>
        {item.excerpt && <p className="feed-item-excerpt">{item.excerpt}</p>}
        {safeUrl && <p className="feed-item-meta">{truncateUrl(item.url)}</p>}
        {significance !== null && (
          <div
            className="sig-meter"
            role="img"
            aria-label={`significance ${Math.round(significance * 100)}%`}
          >
            <div className="sig-meter-fill" style={{ width: `${significance * 100}%` }} />
          </div>
        )}
      </div>
    </article>
  );
});
