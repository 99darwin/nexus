import Anthropic from "@anthropic-ai/sdk";
import type { RawItem } from "./sources/types.js";

export interface TriageConfig {
  apiKey: string;
  model?: string; // default "claude-haiku-4-5-20251001"
}

export interface TriageResult {
  relevant: RawItem[];
  rejected: RawItem[];
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
}

const TRIAGE_PROMPT = `You are a relevance filter for an AI ecosystem knowledge graph. Given a batch of items, determine which ones are about the AI/ML ecosystem.

An item is RELEVANT if it's about:
- AI/ML model releases, updates, or comparisons
- AI companies, funding, acquisitions, partnerships
- AI tools, frameworks, libraries, or platforms
- AI research papers or breakthroughs
- AI hardware (GPUs, TPUs, accelerators)
- AI policy, regulation, or safety
- AI products or applications

An item is NOT RELEVANT if it's:
- General tech news unrelated to AI
- Programming topics without AI connection
- Crypto/blockchain (unless AI-related)
- General business news

Respond with ONLY a JSON array of 0-based indices of the RELEVANT items.
Example: [0, 2, 5, 7]
If none are relevant: []`;

export async function runTriage(items: RawItem[], config: TriageConfig): Promise<TriageResult> {
  if (items.length === 0)
    return {
      relevant: [],
      rejected: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      durationMs: 0,
    };

  const start = Date.now();
  const client = new Anthropic({ apiKey: config.apiKey });

  const userContent = items
    .map((item, i) => `[${i}] ${item.title}\n${item.content?.slice(0, 200) ?? ""}`)
    .join("\n\n");

  const response = await client.messages.create({
    model: config.model ?? "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: TRIAGE_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  // Parse the JSON array of indices
  let indices: number[];
  try {
    const cleaned = text
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();
    indices = JSON.parse(cleaned);
    if (!Array.isArray(indices)) indices = [];
  } catch {
    // Fail closed: reject all items when parsing fails to prevent
    // prompt injection from bypassing triage to reach extraction
    console.warn("[triage] Failed to parse response, rejecting all items");
    indices = [];
  }

  const indexSet = new Set(indices);
  const relevant = items.filter((_, i) => indexSet.has(i));
  const rejected = items.filter((_, i) => !indexSet.has(i));

  return {
    relevant,
    rejected,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    durationMs: Date.now() - start,
  };
}
