import { describe, it, expect, vi, beforeEach } from "vitest";
import { TwitterAdapter } from "../../sources/twitter.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockHeaders = { get: () => null };

function makeApiResponse(tweets: unknown[], users: unknown[] = []) {
  return {
    ok: true,
    headers: mockHeaders,
    json: async () => ({
      data: tweets,
      includes: { users },
    }),
  };
}

const SAMPLE_TWEET = {
  id: "1234567890",
  text: "Introducing Claude 4 — our most capable model yet with breakthrough reasoning.",
  created_at: "2026-03-01T12:00:00Z",
  author_id: "user_1",
  public_metrics: {
    retweet_count: 500,
    reply_count: 200,
    like_count: 3000,
    impression_count: 500000,
  },
  entities: {
    urls: [
      { expanded_url: "https://anthropic.com/claude-4", display_url: "anthropic.com/claude-4" },
    ],
  },
};

const SAMPLE_USER = {
  id: "user_1",
  username: "AnthropicAI",
  name: "Anthropic",
};

describe("TwitterAdapter", () => {
  const adapter = new TwitterAdapter("test-bearer-token");

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("has correct name and priority", () => {
    expect(adapter.name).toBe("twitter");
    expect(adapter.priority).toBe("P1");
  });

  it("parses X API v2 response into RawItems", async () => {
    mockFetch.mockResolvedValue(makeApiResponse([SAMPLE_TWEET], [SAMPLE_USER]));

    const items = await adapter.poll();
    expect(items.length).toBeGreaterThan(0);

    const first = items[0];
    expect(first.source).toBe("twitter");
    expect(first.source_url).toBe("https://x.com/AnthropicAI/status/1234567890");
    expect(first.title).toContain("@AnthropicAI");
    expect(first.published_at).toBe("2026-03-01T12:00:00Z");
    expect(first.raw_metadata).toMatchObject({
      tweet_id: "1234567890",
      author_handle: "AnthropicAI",
      author_name: "Anthropic",
      retweet_count: 500,
      like_count: 3000,
    });
  });

  it("maps author_id to username via includes.users", async () => {
    const tweet = { ...SAMPLE_TWEET, author_id: "user_42" };
    const user = { id: "user_42", username: "OpenAI", name: "OpenAI" };
    mockFetch.mockResolvedValue(makeApiResponse([tweet], [user]));

    const items = await adapter.poll();
    expect(items[0].source_url).toContain("OpenAI");
    expect(items[0].raw_metadata.author_handle).toBe("OpenAI");
  });

  it("deduplicates by tweet URL", async () => {
    mockFetch.mockResolvedValue(
      makeApiResponse([SAMPLE_TWEET, SAMPLE_TWEET], [SAMPLE_USER]),
    );

    const items = await adapter.poll();
    const urls = items.map((i) => i.source_url);
    expect(urls.length).toBe(new Set(urls).size);
  });

  it("handles empty response (no data field)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: mockHeaders,
      json: async () => ({}),
    });

    const items = await adapter.poll();
    expect(items).toEqual([]);
  });

  it("throws on non-OK response", { timeout: 15000 }, async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: mockHeaders,
    });

    await expect(adapter.poll()).rejects.toThrow("X API request failed: 429");
  });

  it("does not retry auth errors (401/403)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      headers: mockHeaders,
    });

    await expect(adapter.poll()).rejects.toThrow("X API request failed: 401");
    // Should only call fetch once (no retries for auth errors)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("skips tweets with invalid IDs", async () => {
    const badTweet = { ...SAMPLE_TWEET, id: "../../malicious" };
    mockFetch.mockResolvedValue(makeApiResponse([badTweet], [SAMPLE_USER]));

    const items = await adapter.poll();
    expect(items).toHaveLength(0);
  });

  it("rejects empty bearer token", () => {
    expect(() => new TwitterAdapter("")).toThrow("X_BEARER_TOKEN is required");
    expect(() => new TwitterAdapter("  ")).toThrow("X_BEARER_TOKEN is required");
  });
});
