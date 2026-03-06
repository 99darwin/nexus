import type { RawItem, SourceAdapter } from "./types.js";

export interface AdapterOptions {
  pollIntervalMs: number;
  maxRetries?: number;
  rateLimitMs?: number;
}

export abstract class BaseAdapter implements SourceAdapter {
  abstract name: string;
  abstract priority: "P0" | "P1" | "P2";

  protected options: Required<AdapterOptions>;
  private lastPollAt = 0;

  constructor(options: AdapterOptions) {
    this.options = {
      pollIntervalMs: options.pollIntervalMs,
      maxRetries: options.maxRetries ?? 3,
      rateLimitMs: options.rateLimitMs ?? 1000,
    };
  }

  async poll(): Promise<RawItem[]> {
    const now = Date.now();
    const elapsed = now - this.lastPollAt;
    if (elapsed < this.options.rateLimitMs) {
      await this.sleep(this.options.rateLimitMs - elapsed);
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      try {
        const items = await this.fetchItems();
        this.lastPollAt = Date.now();
        return items;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Don't retry errors explicitly marked as non-retryable (e.g. 401/403)
        if (lastError.name === "NonRetryableError") break;
        if (attempt < this.options.maxRetries - 1) {
          const backoffMs = Math.min(1000 * 2 ** attempt, 30000);
          await this.sleep(backoffMs);
        }
      }
    }

    throw (
      lastError ?? new Error(`${this.name}: poll failed after ${this.options.maxRetries} attempts`)
    );
  }

  protected abstract fetchItems(): Promise<RawItem[]>;

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected dedupeByUrl(items: RawItem[]): RawItem[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.source_url)) return false;
      seen.add(item.source_url);
      return true;
    });
  }
}
