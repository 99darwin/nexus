import { describe, it, expect, vi, beforeEach } from "vitest";
import { HackerNewsAdapter } from "../../sources/hackernews.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("HackerNewsAdapter", () => {
  const adapter = new HackerNewsAdapter();

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("has correct name and priority", () => {
    expect(adapter.name).toBe("hackernews");
    expect(adapter.priority).toBe("P0");
  });

  it("parses HN Algolia API response into RawItems", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [
          {
            objectID: "12345",
            title: "OpenAI releases GPT-5",
            url: "https://openai.com/gpt-5",
            story_text: null,
            created_at: "2025-01-15T10:00:00Z",
            points: 500,
            num_comments: 200,
            author: "testuser",
          },
          {
            objectID: "12346",
            title: "New CUDA optimizations",
            url: "https://nvidia.com/cuda-update",
            story_text: "Major CUDA improvements for LLM inference",
            created_at: "2025-01-15T11:00:00Z",
            points: 150,
            num_comments: 50,
            author: "gpufan",
          },
        ],
      }),
    });

    const items = await adapter.poll();
    expect(items.length).toBeGreaterThan(0);

    const first = items[0];
    expect(first.source).toBe("hackernews");
    expect(first.source_url).toBeTruthy();
    expect(first.title).toBeTruthy();
    expect(first.published_at).toBeTruthy();
    expect(first.raw_metadata).toHaveProperty("hn_id");
  });

  it("deduplicates items by source_url", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [
          {
            objectID: "100",
            title: "Same article",
            url: "https://example.com/article",
            story_text: null,
            created_at: "2025-01-15T10:00:00Z",
            points: 100,
            num_comments: 10,
            author: "user1",
          },
          {
            objectID: "101",
            title: "Same article repost",
            url: "https://example.com/article",
            story_text: null,
            created_at: "2025-01-15T11:00:00Z",
            points: 50,
            num_comments: 5,
            author: "user2",
          },
        ],
      }),
    });

    const items = await adapter.poll();
    const urls = items.map((i) => i.source_url);
    const uniqueUrls = new Set(urls);
    expect(urls.length).toBe(uniqueUrls.size);
  });

  it("skips items without url or story_text", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [
          {
            objectID: "999",
            title: "No content item",
            url: null,
            story_text: null,
            created_at: "2025-01-15T10:00:00Z",
            points: 10,
            num_comments: 0,
            author: "nobody",
          },
        ],
      }),
    });

    const items = await adapter.poll();
    expect(items.length).toBe(0);
  });
});
