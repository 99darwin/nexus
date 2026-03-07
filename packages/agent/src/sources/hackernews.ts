import type { RawItem } from "./types.js";
import { BaseAdapter } from "./base-adapter.js";

const HN_ALGOLIA_URL = "https://hn.algolia.com/api/v1/search";

const AI_KEYWORDS = [
  "AI",
  "artificial intelligence",
  "machine learning",
  "deep learning",
  "LLM",
  "GPT",
  "ChatGPT",
  "Claude",
  "Gemini",
  "Llama",
  "transformer",
  "neural network",
  "NLP",
  "computer vision",
  "diffusion model",
  "OpenAI",
  "Anthropic",
  "DeepMind",
  "Mistral",
  "Hugging Face",
  "NVIDIA",
  "GPU",
  "TPU",
  "CUDA",
  "fine-tuning",
  "RLHF",
  "langchain",
  "vector database",
  "RAG",
  "embedding",
  "autonomous agent",
  "copilot",
  "code generation",
  "Grok",
  "Perplexity",
  "AI safety",
  "foundation model",
  "open weight",
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
    super({ pollIntervalMs: 2 * 60 * 60 * 1000, rateLimitMs: 2000 });
  }

  protected async fetchItems(): Promise<RawItem[]> {
    const items: RawItem[] = [];

    for (const keyword of this.getSearchQueries()) {
      const url = `${HN_ALGOLIA_URL}?query=${encodeURIComponent(keyword)}&tags=story&hitsPerPage=20&numericFilters=created_at_i>${this.getTimeCutoff()}`;
      const response = await fetch(url);
      if (!response.ok) continue;

      const data = (await response.json()) as HNResponse;

      for (const hit of data.hits) {
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
    // Items from the last 2 hours
    return Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000);
  }
}
