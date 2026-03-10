import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArxivAdapter } from "../../sources/arxiv.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/** Create a mock Response with a streaming body from a string. */
function mockResponse(text: string, ok = true, status = 200) {
  return {
    ok,
    status,
    body: {
      getReader() {
        let done = false;
        return {
          async read() {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: new TextEncoder().encode(text) };
          },
          cancel() {},
        };
      },
    },
  };
}

const MOCK_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>ArXiv cs.AI</title>
    <item>
      <title>Scaling Laws for Foundation Models</title>
      <link>https://arxiv.org/abs/2501.12345</link>
      <description>We investigate scaling laws for large language models across compute, data, and parameters.</description>
      <pubDate>Wed, 15 Jan 2025 00:00:00 GMT</pubDate>
      <category>cs.AI</category>
      <category>cs.CL</category>
    </item>
    <item>
      <title>Efficient Transformer Attention for Long Contexts</title>
      <link>https://arxiv.org/abs/2501.12346</link>
      <description>Novel LLM attention mechanism enabling efficient processing of million-token contexts.</description>
      <pubDate>Wed, 15 Jan 2025 01:00:00 GMT</pubDate>
      <category>cs.CL</category>
    </item>
  </channel>
</rss>`;

describe("ArxivAdapter", () => {
  const adapter = new ArxivAdapter();

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("has correct name and priority", () => {
    expect(adapter.name).toBe("arxiv");
    expect(adapter.priority).toBe("P1");
  });

  it("parses RSS XML into RawItems", async () => {
    mockFetch.mockResolvedValue(mockResponse(MOCK_RSS));

    const items = await adapter.poll();
    expect(items).toHaveLength(2);

    const first = items[0];
    expect(first.source).toBe("arxiv");
    expect(first.source_url).toBe("https://arxiv.org/abs/2501.12345");
    expect(first.title).toBe("Scaling Laws for Foundation Models");
    expect(first.content).toContain("scaling laws");
    expect(first.raw_metadata).toHaveProperty("arxiv_id", "2501.12345");
    expect(first.raw_metadata).toHaveProperty("categories");
  });

  it("handles empty RSS feed", async () => {
    mockFetch.mockResolvedValue(
      mockResponse('<?xml version="1.0"?><rss><channel><title>Empty</title></channel></rss>'),
    );

    const items = await adapter.poll();
    expect(items).toHaveLength(0);
  });

  it("throws on non-OK response", { timeout: 15000 }, async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    await expect(adapter.poll()).rejects.toThrow();
  });
});
