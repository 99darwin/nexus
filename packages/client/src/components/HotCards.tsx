import type { FeedItem } from "../data/feed-types";
import { isSafeHttpUrl, relativeTime } from "../data/time";
import { nodeColor, verticalLabel } from "../theme/vertical-colors";

interface HotCardsProps {
  /** top items by significance, already ranked by the feed store */
  items: FeedItem[];
}

export function HotCards({ items }: HotCardsProps) {
  if (items.length === 0) return null;

  return (
    <section className="hot" aria-label="most significant">
      <h2 className="section-label">what&apos;s hot</h2>
      <div className="hot-rail">
        {items.map((item) => (
          <article key={item.id} className="hot-card">
            <p className="hot-card-meta">
              <span
                className="chip-swatch"
                style={{ background: nodeColor(item.vertical), display: "inline-block" }}
                aria-hidden="true"
              />{" "}
              {verticalLabel(item.vertical)}
            </p>
            <h3 className="hot-card-title">
              {isSafeHttpUrl(item.url) ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.title}
                </a>
              ) : (
                item.title
              )}
            </h3>
            <p className="hot-card-meta">
              {item.source} · {relativeTime(item.published_at)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
