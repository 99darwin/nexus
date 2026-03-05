import type { RawItem } from "./sources/types.js";
import type { RunnerResult } from "./runner.js";
import type { TriageResult } from "./triage.js";
import { runTriage } from "./triage.js";
import { runExtraction } from "./runner.js";
import type { MutationOp } from "@nexus/shared";
import { validateMutationOp } from "@nexus/shared";

export interface PipelineConfig {
  apiKey: string;
  triageModel?: string;
  extractionModel?: string;
  maxRetries?: number;
}

export interface PipelineResult {
  triageResult: TriageResult;
  extractionResult: RunnerResult | null;
  validMutations: MutationOp[];
  invalidMutations: Array<{ mutation: unknown; errors: string[] }>;
  totalCost: { inputTokens: number; outputTokens: number };
}

export async function runPipeline(items: RawItem[], config: PipelineConfig): Promise<PipelineResult> {
  // Stage 1: Triage
  const triageResult = await runTriage(items, {
    apiKey: config.apiKey,
    model: config.triageModel,
  });

  if (triageResult.relevant.length === 0) {
    return {
      triageResult,
      extractionResult: null,
      validMutations: [],
      invalidMutations: [],
      totalCost: triageResult.usage,
    };
  }

  // Stage 2: Extraction with retry
  const maxRetries = config.maxRetries ?? 2;
  let extractionResult: RunnerResult | null = null;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      extractionResult = await runExtraction(triageResult.relevant, {
        apiKey: config.apiKey,
        model: config.extractionModel,
      });
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) break;
      // On JSON parse failure, retry
      console.warn(`Extraction attempt ${attempt + 1} failed: ${lastError.message}, retrying...`);
    }
  }

  if (!extractionResult) {
    throw lastError ?? new Error("Extraction failed");
  }

  // Stage 3: Validate mutations, keep valid ones
  const validMutations: MutationOp[] = [];
  const invalidMutations: Array<{ mutation: unknown; errors: string[] }> = [];

  for (const mutation of extractionResult.output.mutations) {
    const result = validateMutationOp(mutation);
    if (result.isValid) {
      validMutations.push(mutation);
    } else {
      invalidMutations.push({ mutation, errors: result.errors });
    }
  }

  return {
    triageResult,
    extractionResult,
    validMutations,
    invalidMutations,
    totalCost: {
      inputTokens: triageResult.usage.inputTokens + extractionResult.usage.inputTokens,
      outputTokens: triageResult.usage.outputTokens + extractionResult.usage.outputTokens,
    },
  };
}
