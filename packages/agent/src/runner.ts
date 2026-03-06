import Anthropic from "@anthropic-ai/sdk";
import type { AgentOutput } from "@nexus/shared";
import { validateAgentOutput } from "@nexus/shared";
import { SYSTEM_PROMPT } from "./prompts/system-prompt.js";
import type { RawItem } from "./sources/types.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 16384;

export interface RunnerConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export interface RunnerResult {
  output: AgentOutput;
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
}

function formatItemsPrompt(items: RawItem[]): string {
  const formatted = items.map((item, i) => {
    return [
      `--- Item ${i + 1} ---`,
      `Source: ${item.source}`,
      `URL: ${item.source_url}`,
      `Title: ${item.title}`,
      `Published: ${item.published_at}`,
      `Content:\n${item.content}`,
    ].join("\n");
  });

  return [
    `Analyze the following ${items.length} item(s) and extract graph mutations.`,
    "",
    "IMPORTANT: You MUST respond with ONLY a JSON object — no prose, no markdown, no explanation outside the JSON.",
    'If no entities can be extracted, respond with: {"mutations": [], "analysis": "No extractable entities."}',
    "",
    ...formatted,
  ].join("\n");
}

function parseJsonFromResponse(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Handle markdown code blocks: ```json ... ``` or ``` ... ```
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (!codeBlockMatch) {
      throw new Error("Response is not valid JSON and contains no code blocks");
    }
    return JSON.parse(codeBlockMatch[1]);
  }
}

export async function runExtraction(
  items: RawItem[],
  config: RunnerConfig,
): Promise<RunnerResult> {
  if (items.length === 0) {
    throw new Error("Items array must not be empty");
  }

  const model = config.model ?? DEFAULT_MODEL;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;

  const client = new Anthropic({ apiKey: config.apiKey });
  const userPrompt = formatItemsPrompt(items);

  const startTime = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: userPrompt },
      { role: "assistant", content: "{" },
    ],
  });

  const durationMs = Date.now() - startTime;

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text content in Anthropic response");
  }

  // Log truncation and raw response for debugging
  if (response.stop_reason === "max_tokens") {
    console.warn(`[extraction] Response truncated at ${maxTokens} tokens`);
  }

  // Prepend the "{" prefill to reconstruct the full JSON
  const rawJson = "{" + textBlock.text;
  console.log(`[extraction] stop_reason=${response.stop_reason} response_length=${rawJson.length}`);

  const parsed = parseJsonFromResponse(rawJson);
  const validation = validateAgentOutput(parsed);

  if (!validation.isValid) {
    throw new Error(
      `Invalid AgentOutput from LLM: ${validation.errors.join("; ")}`,
    );
  }

  return {
    output: parsed as AgentOutput,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    durationMs,
  };
}
