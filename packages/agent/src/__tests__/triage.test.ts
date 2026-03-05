import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTriage } from "../triage.js";
import type { RawItem } from "../sources/types.js";

// Mock Anthropic SDK
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

const makeItem = (title: string, content = ""): RawItem => ({
  source: "test",
  source_url: `https://example.com/${title.toLowerCase().replace(/\s+/g, "-")}`,
  title,
  content,
  published_at: new Date().toISOString(),
  raw_metadata: {},
});

describe("runTriage", () => {
  beforeEach(() => { mockCreate.mockReset(); });

  it("filters relevant AI items", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "[0, 2]" }],
      usage: { input_tokens: 100, output_tokens: 10 },
    });
    const items = [
      makeItem("OpenAI releases GPT-5"),
      makeItem("Best pizza recipes 2024"),
      makeItem("New NVIDIA GPU announced"),
    ];
    const result = await runTriage(items, { apiKey: "test-key" });
    expect(result.relevant).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.relevant[0].title).toBe("OpenAI releases GPT-5");
    expect(result.relevant[1].title).toBe("New NVIDIA GPU announced");
  });

  it("handles empty input", async () => {
    const result = await runTriage([], { apiKey: "test-key" });
    expect(result.relevant).toHaveLength(0);
    expect(result.durationMs).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("keeps all items if JSON parsing fails", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "I think items 0 and 2 are relevant" }],
      usage: { input_tokens: 50, output_tokens: 20 },
    });
    const items = [makeItem("AI news"), makeItem("Other news")];
    const result = await runTriage(items, { apiKey: "test-key" });
    expect(result.relevant).toHaveLength(2); // fail open
  });

  it("rejects all when none are relevant", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "[]" }],
      usage: { input_tokens: 50, output_tokens: 5 },
    });
    const items = [makeItem("Pizza review"), makeItem("Cat videos")];
    const result = await runTriage(items, { apiKey: "test-key" });
    expect(result.relevant).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
  });
});
