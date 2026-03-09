import type { RawItem } from "./types.js";
import { BaseAdapter } from "./base-adapter.js";

const ARXIV_RSS_URL = "https://rss.arxiv.org/rss/cs.AI+cs.CL+cs.LG";
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const MAX_RSS_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Cheap keyword pre-filter applied to title + abstract BEFORE LLM triage.
 * Keeps papers likely relevant to the AI ecosystem graph; drops pure theory,
 * linguistics, and narrow ML optimization papers that would waste triage tokens.
 */
const RELEVANCE_PATTERNS = [
  // Model families & architectures
  /\bgpt[-\s]?\d/i, /\bclaude\b/i, /\bgemini\b/i, /\bllama\b/i, /\bmistral\b/i,
  /\bdeepseek\b/i, /\bqwen\b/i, /\bphi[-\s]?\d/i, /\bcommand[\s-]?r/i,
  /\bllm\b/i, /\blarge language model/i, /\bfoundation model/i,
  /\btransformer\b/i, /\bdiffusion model/i, /\bmultimodal/i,
  // Companies & orgs
  /\bopenai\b/i, /\banthropic\b/i, /\bdeep\s?mind\b/i, /\bmeta\s+ai\b/i,
  /\bnvidia\b/i, /\bhugging\s?face\b/i, /\bstability\s?ai\b/i, /\bcohere\b/i,
  // Ecosystem concepts
  /\bagent\b/i, /\balignment\b/i, /\brlhf\b/i, /\breinforcement learning from human/i,
  /\bsafety\b/i, /\bbenchmark/i, /\binstruction[\s-]?tun/i, /\bfine[\s-]?tun/i,
  /\bpre[\s-]?train/i, /\bscaling law/i, /\bchain[\s-]?of[\s-]?thought/i,
  /\breasoning\b/i, /\bcode gen/i, /\bchat\s?bot\b/i,
  /\btext[\s-]?to[\s-]?(image|video|speech|audio)/i, /\bgenerative ai\b/i,
  /\bopen[\s-]?source\b.*\bmodel\b/i, /\bmodel\b.*\bopen[\s-]?source\b/i,
  // Infrastructure
  /\binference\b/i, /\bserving\b/i, /\bquantiz/i, /\bdeployment\b/i,
  /\bgpu\b/i, /\btpu\b/i,
  // Frameworks & tools
  /\blangchain\b/i, /\bllamaindex\b/i, /\bvllm\b/i, /\brag\b/i,
  /\bretrieval[\s-]?augmented/i,
];

function isLikelyRelevant(title: string, content: string): boolean {
  const text = `${title} ${content}`;
  return RELEVANCE_PATTERNS.some((pattern) => pattern.test(text));
}

export class ArxivAdapter extends BaseAdapter {
  name = "arxiv";
  priority = "P1" as const;

  constructor() {
    super({ pollIntervalMs: TWENTY_FOUR_HOURS_MS, rateLimitMs: 3000 });
  }

  protected async fetchItems(): Promise<RawItem[]> {
    const response = await fetch(ARXIV_RSS_URL);
    if (!response.ok) throw new Error(`ArXiv RSS fetch failed: ${response.status}`);

    const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_RSS_BYTES) {
      throw new Error(`ArXiv RSS response too large: ${contentLength} bytes`);
    }

    const xml = await response.text();
    const allItems = this.parseRss(xml);
    const relevant = allItems.filter((item) => isLikelyRelevant(item.title, item.content));
    console.log(`[arxiv] pre-filter: ${allItems.length} → ${relevant.length} relevant`);
    return relevant;
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
        published_at: this.safeParseDate(pubDate),
        raw_metadata: {
          arxiv_id: arxivId,
          categories: this.extractCategories(itemXml),
        },
      });
    }

    return items;
  }

  private extractTag(xml: string, tag: string): string | null {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i");
    const match = regex.exec(xml);
    return match ? match[1].trim() : null;
  }

  private safeParseDate(dateStr: string | null): string {
    if (!dateStr) return new Date().toISOString();
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
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
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }
}
