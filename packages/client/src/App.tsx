import { useCallback, useEffect, useState } from "react";
import { useFeedStore } from "./data/feed-store";
import { ActivityFeed } from "./components/ActivityFeed";
import { ChatBox } from "./components/ChatBox";
import { SearchPalette } from "./components/SearchPalette";
import { useVisualViewportHeight } from "./hooks/use-visual-viewport";

const SECTIONS = ["feed", "chat"] as const;
type Section = (typeof SECTIONS)[number];

export function App() {
  const store = useFeedStore();
  const [section, setSection] = useState<Section>("feed");
  const [showSearch, setShowSearch] = useState(false);
  /* `token` rises on every selection so picking the same row twice still scrolls */
  const [marked, setMarked] = useState<{ id: string; token: number }>({ id: "", token: 0 });

  useVisualViewportHeight();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // caps lock / shift produce "K"; the shortcut is the same either way
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowSearch((prev) => !prev);
        return;
      }
      if (event.key === "Escape") setShowSearch(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSearchSelect = useCallback((itemId: string) => {
    setSection("feed");
    setMarked((prev) => ({ id: itemId, token: prev.token + 1 }));
  }, []);

  const activeIndex = SECTIONS.indexOf(section);

  return (
    <div className="screen">
      <header className="chrome">
        <h1 className="wordmark">nexus</h1>
        {/* labelled "primary", not "sections": search opens a dialog rather than
            switching section, so it is nav but not one of the two panels */}
        <nav className="nav" aria-label="primary">
          {/* cmd-k is invisible on touch and to anyone who does not know it exists */}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-keyshortcuts="Meta+K Control+K"
            onClick={() => setShowSearch(true)}
          >
            search
          </button>
          {SECTIONS.map((name) => (
            <button
              key={name}
              type="button"
              aria-current={section === name ? "page" : undefined}
              onClick={() => setSection(name)}
            >
              {name}
            </button>
          ))}
        </nav>
      </header>

      <div className="viewport">
        {SECTIONS.map((name, index) => {
          const offset = index - activeIndex;
          const position = offset === 0 ? "" : offset > 0 ? " section-below" : " section-above";
          return (
            <section
              key={name}
              className={`section${position}`}
              aria-label={name}
              aria-hidden={offset !== 0}
              inert={offset !== 0}
            >
              {name === "feed" ? (
                <ActivityFeed
                  items={store.items}
                  hot={store.hot}
                  meta={store.meta}
                  status={store.status}
                  loadingMore={store.loadingMore}
                  hasMore={store.hasMore}
                  hasFilters={store.hasFilters}
                  activeVertical={store.activeVertical}
                  activeEventType={store.activeEventType}
                  markedItemId={marked.id || null}
                  markToken={marked.token}
                  onVerticalToggle={store.toggleVertical}
                  onEventTypeToggle={store.toggleEventType}
                  onClearFilters={store.clearFilters}
                  onLoadMore={store.loadMore}
                  onRetry={store.retry}
                />
              ) : (
                <ChatBox active={section === "chat"} />
              )}
            </section>
          );
        })}
      </div>

      {showSearch && (
        <SearchPalette
          items={store.items}
          onSelect={handleSearchSelect}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
  );
}
