import type { RawItem } from "./types.js";
import { BaseAdapter } from "./base-adapter.js";

const GITHUB_TRENDING_API = "https://api.github.com/search/repositories";

const AI_TOPICS = [
  "machine-learning",
  "deep-learning",
  "llm",
  "artificial-intelligence",
  "transformers",
  "diffusion-models",
];

export class GitHubTrendingAdapter extends BaseAdapter {
  name = "github";
  priority = "P0" as const;

  private token?: string;

  constructor(token?: string) {
    super({ pollIntervalMs: 60 * 60 * 1000, rateLimitMs: 5000 });
    this.token = token;
  }

  protected async fetchItems(): Promise<RawItem[]> {
    const items: RawItem[] = [];
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    for (const topic of AI_TOPICS.slice(0, 3)) {
      const query = `topic:${topic} created:>${oneWeekAgo} stars:>10`;
      const url = `${GITHUB_TRENDING_API}?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=10`;

      const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;

      const response = await fetch(url, { headers });
      if (!response.ok) continue;

      const data = (await response.json()) as { items: GitHubRepo[] };

      for (const repo of data.items ?? []) {
        items.push({
          source: "github",
          source_url: repo.html_url,
          title: `${repo.full_name}: ${repo.description ?? ""}`.trim(),
          content: [
            repo.description ?? "",
            `Stars: ${repo.stargazers_count}`,
            `Language: ${repo.language ?? "unknown"}`,
            `Topics: ${(repo.topics ?? []).join(", ")}`,
          ].join("\n"),
          published_at: repo.created_at,
          raw_metadata: {
            full_name: repo.full_name,
            stars: repo.stargazers_count,
            forks: repo.forks_count,
            language: repo.language,
            topics: repo.topics ?? [],
          },
        });
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.source_url)) return false;
      seen.add(item.source_url);
      return true;
    });
  }
}

interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  created_at: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics: string[];
}
