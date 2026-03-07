import type { RawItem } from "./types.js";
import { BaseAdapter } from "./base-adapter.js";

const ARXIV_RSS_URL = "https://rss.arxiv.org/rss/cs.AI+cs.CL+cs.LG";

export class ArxivAdapter extends BaseAdapter {
  name = "arxiv";
  priority = "P0" as const;

  constructor() {
    super({ pollIntervalMs: 2 * 60 * 60 * 1000, rateLimitMs: 3000 });
  }

  protected async fetchItems(): Promise<RawItem[]> {
    const response = await fetch(ARXIV_RSS_URL);
    if (!response.ok) throw new Error(`ArXiv RSS fetch failed: ${response.status}`);

    const xml = await response.text();
    return this.parseRss(xml);
  }

  private parseRss(xml: string): RawItem[] {
    const items: RawItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const title = this.extractTag(itemXml, "title");
      const link = this.extractTag(itemXml, "link");
      const description = this.extractTag(itemXml, "description");
      const pubDate = this.extractTag(itemXml, "pubDate") ?? this.extractTag(itemXml, "dc:date");

      if (!title || !link) continue;

      // Extract arXiv ID from link
      const arxivId = link.match(/abs\/(\d+\.\d+)/)?.[1] ?? "";

      items.push({
        source: "arxiv",
        source_url: link,
        title: this.cleanHtml(title),
        content: this.cleanHtml(description ?? ""),
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        raw_metadata: {
          arxiv_id: arxivId,
          categories: this.extractCategories(itemXml),
        },
      });
    }

    return items;
  }

  private extractTag(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const match = regex.exec(xml);
    return match ? match[1].trim() : null;
  }

  private extractCategories(xml: string): string[] {
    const categories: string[] = [];
    const catRegex = /<category[^>]*>([^<]*)<\/category>/gi;
    let match;
    while ((match = catRegex.exec(xml)) !== null) {
      categories.push(match[1].trim());
    }
    return categories;
  }

  private cleanHtml(text: string): string {
    return text
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }
}
