import { useCallback, useMemo, useState } from "react";
import Fuse from "fuse.js";
import type { FeedItem } from "../data/feed-types";

export interface SearchResult {
  item: FeedItem;
  score: number;
}

/** Client-side fuzzy search over the items already loaded into the feed. */
export function useSearch(items: FeedItem[]) {
  const [query, setQuery] = useState("");

  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: [
          { name: "title", weight: 2 },
          { name: "excerpt", weight: 1 },
          { name: "source", weight: 0.5 },
          { name: "vertical", weight: 0.5 },
        ],
        threshold: 0.4,
        includeScore: true,
      }),
    [items],
  );

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return fuse.search(query, { limit: 20 }).map((result) => ({
      item: result.item,
      score: result.score ?? 0,
    }));
  }, [fuse, query]);

  const search = useCallback((next: string) => setQuery(next), []);
  const clear = useCallback(() => setQuery(""), []);

  return { query, results, search, clear };
}
