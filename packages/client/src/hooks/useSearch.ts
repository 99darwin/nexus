import { useMemo, useState, useCallback } from "react";
import Fuse from "fuse.js";
import type { ForceNode } from "../graph/types";

export interface SearchResult {
  item: ForceNode;
  score: number;
}

export function useSearch(nodes: ForceNode[]) {
  const [query, setQuery] = useState("");

  const fuse = useMemo(
    () =>
      new Fuse(nodes, {
        keys: [
          { name: "name", weight: 2 },
          { name: "summary", weight: 1 },
          { name: "type", weight: 0.5 },
          { name: "vertical", weight: 0.5 },
        ],
        threshold: 0.4,
        includeScore: true,
      }),
    [nodes],
  );

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return fuse.search(query, { limit: 20 }).map((result) => ({
      item: result.item,
      score: result.score ?? 0,
    }));
  }, [fuse, query]);

  const search = useCallback((q: string) => setQuery(q), []);
  const clear = useCallback(() => setQuery(""), []);

  return { query, results, search, clear };
}
