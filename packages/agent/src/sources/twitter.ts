import type { RawItem } from "./types.js";
import { BaseAdapter } from "./base-adapter.js";
import { TWITTER_ACCOUNTS, type TwitterAccount } from "./twitter-accounts.js";

const SKIP_TRIAGE_CATEGORIES = new Set<TwitterAccount["category"]>(["lab", "company"]);

const X_API_BASE = "https://api.x.com/2";
const MAX_QUERY_LENGTH = 512;
const CHUNK_DELAY_MS = 1000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB

const TWEET_ID_RE = /^\d{1,20}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

/** HTTP status codes that should not be retried. */
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403]);

interface Tweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    impression_count: number;
  };
  entities?: {
    urls?: Array<{ expanded_url: string; display_url: string }>;
  };
}

interface XUser {
  id: string;
  username: string;
  name: string;
}

interface XError {
  message: string;
  title?: string;
  type?: string;
}

interface XSearchResponse {
  data?: Tweet[];
  includes?: { users?: XUser[] };
  errors?: XError[];
  meta?: { result_count?: number };
}

export class TwitterAdapter extends BaseAdapter {
  name = "twitter";
  priority = "P1" as const;

  #bearerToken: string;
  private lookbackMs: number;

  constructor(bearerToken: string, lookbackMs = 2 * 60 * 60 * 1000) {
    super({ pollIntervalMs: 2 * 60 * 60 * 1000, rateLimitMs: 2000 });
    if (!bearerToken.trim()) {
      throw new Error("X_BEARER_TOKEN is required but was empty");
    }
    this.#bearerToken = bearerToken;
    this.lookbackMs = lookbackMs;
  }

  protected async fetchItems(): Promise<RawItem[]> {
    const chunks = this.buildQueryChunks();
    const handleCategory = new Map(
      TWITTER_ACCOUNTS.map((a) => [a.handle.toLowerCase(), a.category]),
    );
    const items: RawItem[] = [];

    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await this.sleep(CHUNK_DELAY_MS);

      const startTime = new Date(Date.now() - this.lookbackMs).toISOString();
      const params = new URLSearchParams({
        query: chunks[i],
        max_results: "100",
        "tweet.fields": "created_at,author_id,public_metrics,entities",
        expansions: "author_id",
        start_time: startTime,
      });

      const url = `${X_API_BASE}/tweets/search/recent?${params}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.#bearerToken}` },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const msg = `X API ${response.status}: ${body || response.statusText}`;
        if (NON_RETRYABLE_STATUSES.has(response.status)) {
          const err = new Error(msg);
          err.name = "NonRetryableError";
          throw err;
        }
        throw new Error(msg);
      }

      // Guard against oversized responses
      const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10);
      if (contentLength > MAX_RESPONSE_BYTES) {
        throw new Error(`X API response too large: ${contentLength} bytes`);
      }

      const data = (await response.json()) as XSearchResponse;

      // Surface API-level errors returned with 200 status
      if (data.errors && !data.data) {
        const msgs = data.errors.map((e) => e.message).join("; ");
        console.warn(`[twitter] chunk ${i + 1}/${chunks.length} API errors: ${msgs}`);
        continue;
      }

      if (!data.data) {
        console.debug(`[twitter] chunk ${i + 1}/${chunks.length}: 0 results`);
        continue;
      }

      console.debug(`[twitter] chunk ${i + 1}/${chunks.length}: ${data.data.length} tweets`);

      const userMap = this.buildUserMap(data.includes?.users);

      for (const tweet of data.data) {
        // Validate tweet ID and username to prevent injection via malformed responses
        if (!tweet.id || !TWEET_ID_RE.test(tweet.id)) continue;

        const user = userMap.get(tweet.author_id ?? "");
        const handle =
          user?.username && USERNAME_RE.test(user.username) ? user.username : "unknown";
        const content = this.expandUrls(tweet);
        const category = handleCategory.get(handle.toLowerCase());
        const skipTriage = category ? SKIP_TRIAGE_CATEGORIES.has(category) : false;

        items.push({
          source: "twitter",
          source_url: `https://x.com/${handle}/status/${tweet.id}`,
          title: `@${handle}: ${tweet.text.slice(0, 120)}`,
          content,
          published_at: tweet.created_at ?? new Date().toISOString(),
          skip_triage: skipTriage,
          raw_metadata: {
            tweet_id: tweet.id,
            author_handle: handle,
            author_name: user?.name?.slice(0, 100) ?? handle,
            retweet_count: tweet.public_metrics?.retweet_count ?? 0,
            like_count: tweet.public_metrics?.like_count ?? 0,
            reply_count: tweet.public_metrics?.reply_count ?? 0,
            impression_count: tweet.public_metrics?.impression_count ?? 0,
          },
        });
      }
    }

    const deduped = this.dedupeByUrl(items);
    const skippingTriage = deduped.filter((i) => i.skip_triage).length;
    console.log(
      `[twitter] poll complete: ${deduped.length} items (${skippingTriage} skip triage) from ${chunks.length} chunks`,
    );
    return deduped;
  }

  private buildQueryChunks(): string[] {
    const handles = TWITTER_ACCOUNTS.map((a) => a.handle);
    const suffix = " -is:retweet";
    const chunks: string[] = [];
    let current: string[] = [];

    for (const handle of handles) {
      const candidate = [...current, handle];
      const query = this.formatQuery(candidate) + suffix;

      if (query.length > MAX_QUERY_LENGTH && current.length > 0) {
        chunks.push(this.formatQuery(current) + suffix);
        current = [handle];
      } else {
        current = candidate;
      }
    }

    if (current.length > 0) {
      chunks.push(this.formatQuery(current) + suffix);
    }

    return chunks;
  }

  private formatQuery(handles: string[]): string {
    return `(${handles.map((h) => `from:${h}`).join(" OR ")})`;
  }

  private buildUserMap(users?: XUser[]): Map<string, XUser> {
    const map = new Map<string, XUser>();
    if (!users) return map;
    for (const user of users) {
      map.set(user.id, user);
    }
    return map;
  }

  private expandUrls(tweet: Tweet): string {
    let text = tweet.text;
    if (tweet.entities?.urls) {
      for (const url of tweet.entities.urls) {
        text = text.replace(url.display_url, url.expanded_url);
      }
    }
    return text;
  }
}
