import type { RawItem } from "./types.js";
import { BaseAdapter } from "./base-adapter.js";
import { discardBody, readBoundedJson } from "./http.js";

const HN_ALGOLIA_URL = "https://hn.algolia.com/api/v1/search";

// Consolidated keyword list — fewer broader queries to reduce API calls.
// "AI" and "LLM" already catch most items; model/company names catch the rest.
const AI_KEYWORDS = [
  "LLM",
  "GPT",
  "Claude AI",
  "Gemini AI",
  "Llama model",
  "Mistral AI",
  "OpenAI",
  "Anthropic",
  "DeepMind",
  "Hugging Face",
  "machine learning",
  "diffusion model",
  "AI safety",
  "foundation model",
  "AI agent",
  "RAG retrieval",
];

interface HNHit {
  objectID: string;
  title: string;
  url: string | null;
  story_text: string | null;
  created_at: string;
  points: number;
  num_comments: number;
  author: string;
}

interface HNResponse {
  hits: HNHit[];
}

export class HackerNewsAdapter extends BaseAdapter {
  name = "hackernews";
  priority = "P0" as const;

  constructor() {
    super({ pollIntervalMs: 8 * 60 * 60 * 1000, rateLimitMs: 2000 });
  }

  protected async fetchItems(signal?: AbortSignal): Promise<RawItem[]> {
    const items: RawItem[] = [];

    for (const keyword of this.getSearchQueries()) {
      // One keyword per request: check between them so a cancelled cycle stops
      // at the next boundary instead of working through the whole list.
      signal?.throwIfAborted();
      const url = `${HN_ALGOLIA_URL}?query=${encodeURIComponent(keyword)}&tags=story&hitsPerPage=20&numericFilters=created_at_i>${this.getTimeCutoff()}`;
      const response = await fetch(url, { signal });
      if (!response.ok) {
        await discardBody(response);
        continue;
      }

      const data = await readBoundedJson<HNResponse>(response, { label: "hn algolia" });

      for (const hit of data.hits ?? []) {
        if (!hit.url && !hit.story_text) continue;
        items.push({
          source: "hackernews",
          source_url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
          title: hit.title ?? "",
          content: hit.story_text ?? hit.title ?? "",
          published_at: hit.created_at,
          raw_metadata: {
            hn_id: hit.objectID,
            points: hit.points,
            num_comments: hit.num_comments,
            author: hit.author,
          },
        });
      }
    }

    // Deduplicate by source_url
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.source_url)) return false;
      seen.add(item.source_url);
      return true;
    });
  }

  private getSearchQueries(): string[] {
    return AI_KEYWORDS;
  }

  private getTimeCutoff(): number {
    // Items from the last 8 hours (matches poll interval)
    return Math.floor((Date.now() - 8 * 60 * 60 * 1000) / 1000);
  }
}
