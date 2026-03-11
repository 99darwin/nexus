import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RawItem } from "../sources/types.js";
import type { RunnerConfig } from "../runner.js";

const VALID_AGENT_OUTPUT = {
  mutations: [
    {
      op: "upsert_node",
      node: {
        id: "anthropic/claude-4",
        type: "model",
        name: "Claude 4",
        vertical: "foundation_models",
        verticals_secondary: ["agents"],
        status: "ga",
        discovered_at: "2025-06-01T00:00:00Z",
        updated_at: "2025-06-01T00:00:00Z",
        events: [
          {
            timestamp: "2025-06-01T00:00:00Z",
            event_type: "launch",
            summary: "Claude 4 released",
            source_url: "https://anthropic.com/claude-4",
          },
        ],
        significance: 0.95,
        summary: "Anthropic's frontier model with advanced reasoning.",
        metadata: { parameters: "unknown" },
      },
    },
    {
      op: "upsert_edge",
      edge: {
        source_id: "anthropic/claude-4",
        target_id: "anthropic/claude-3.5-sonnet",
        relationship: "succeeded_by",
        discovered_at: "2025-06-01T00:00:00Z",
        confidence: 0.95,
        evidence: "Claude 4 is the successor to Claude 3.5 Sonnet",
      },
    },
  ],
  analysis: "Anthropic released Claude 4, their latest frontier model.",
};

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
    })),
  };
});

const SAMPLE_ITEM: RawItem = {
  source: "techcrunch",
  source_url: "https://techcrunch.com/2025/06/01/anthropic-claude-4",
  title: "Anthropic launches Claude 4",
  content:
    "Anthropic has released Claude 4, their latest frontier model with advanced reasoning capabilities. It succeeds Claude 3.5 Sonnet.",
  published_at: "2025-06-01T00:00:00Z",
  raw_metadata: { author: "Test Author" },
};

const DEFAULT_CONFIG: RunnerConfig = {
  apiKey: "test-api-key",
};

describe("runExtraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes valid items and returns AgentOutput", async () => {
    // Response omits leading "{" since the code prefills it
    const responseText = JSON.stringify(VALID_AGENT_OUTPUT).slice(1);
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: responseText }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1500, output_tokens: 800 },
    });

    const { runExtraction } = await import("../runner.js");
    const result = await runExtraction([SAMPLE_ITEM], DEFAULT_CONFIG);

    expect(result.output).toEqual(VALID_AGENT_OUTPUT);
    expect(result.usage.inputTokens).toBe(1500);
    expect(result.usage.outputTokens).toBe(800);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8192,
        system: [
          expect.objectContaining({
            type: "text",
            cache_control: { type: "ephemeral" },
          }),
        ],
        messages: [
          { role: "user", content: expect.stringContaining("Anthropic launches Claude 4") },
          { role: "assistant", content: "{" },
        ],
      }),
    );
  });

  it("rejects empty items array", async () => {
    const { runExtraction } = await import("../runner.js");

    await expect(runExtraction([], DEFAULT_CONFIG)).rejects.toThrow(
      "Items array must not be empty",
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("handles JSON wrapped in markdown code blocks", async () => {
    const fullJson = JSON.stringify(VALID_AGENT_OUTPUT, null, 2);
    // Model returns a code block containing full JSON; prefill "{" + this
    // won't parse directly, so falls through to code block extraction
    const wrappedResponse = `\n\n\`\`\`json\n${fullJson}\n\`\`\``;

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: wrappedResponse }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1200, output_tokens: 600 },
    });

    const { runExtraction } = await import("../runner.js");
    const result = await runExtraction([SAMPLE_ITEM], DEFAULT_CONFIG);

    expect(result.output).toEqual(VALID_AGENT_OUTPUT);
    expect(result.usage.inputTokens).toBe(1200);
    expect(result.usage.outputTokens).toBe(600);
  });

  it("throws on invalid AgentOutput from LLM", async () => {
    const invalidOutput = {
      mutations: [
        {
          op: "upsert_node",
          node: {
            id: "",
            type: "invalid_type",
            name: "",
          },
        },
      ],
      analysis: "",
    };

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(invalidOutput).slice(1) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1000, output_tokens: 400 },
    });

    const { runExtraction } = await import("../runner.js");

    await expect(runExtraction([SAMPLE_ITEM], DEFAULT_CONFIG)).rejects.toThrow(
      "Invalid AgentOutput from LLM",
    );
  });
});
