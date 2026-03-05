export interface TwitterAccount {
  handle: string;
  category: "lab" | "researcher" | "company" | "media" | "oss" | "org";
  description: string;
}

export const TWITTER_ACCOUNTS: TwitterAccount[] = [
  // Labs
  { handle: "AnthropicAI", category: "lab", description: "Anthropic — Claude" },
  { handle: "OpenAI", category: "lab", description: "OpenAI — GPT, o-series" },
  { handle: "GoogleDeepMind", category: "lab", description: "Google DeepMind — Gemini" },
  { handle: "xai", category: "lab", description: "xAI — Grok" },
  { handle: "MistralAI", category: "lab", description: "Mistral AI" },
  { handle: "AIatMeta", category: "lab", description: "Meta AI — Llama" },
  { handle: "CohereAI", category: "lab", description: "Cohere — Command R" },
  { handle: "StabilityAI", category: "lab", description: "Stability AI — Stable Diffusion" },

  // Researchers
  { handle: "DarioAmodei", category: "researcher", description: "CEO, Anthropic" },
  { handle: "sama", category: "researcher", description: "CEO, OpenAI" },
  { handle: "ylecun", category: "researcher", description: "Chief AI Scientist, Meta" },
  { handle: "demaborishassabis", category: "researcher", description: "CEO, Google DeepMind" },
  { handle: "jackclaborark", category: "researcher", description: "Co-founder, Anthropic" },
  { handle: "AndrejKarpathy", category: "researcher", description: "AI educator, ex-Tesla/OpenAI" },
  { handle: "jeffdean", category: "researcher", description: "Chief Scientist, Google DeepMind" },
  { handle: "fcaborhollet", category: "researcher", description: "Keras creator, ARC Prize" },

  // Companies
  { handle: "huggingface", category: "company", description: "Hugging Face — model hub" },
  { handle: "nvidia", category: "company", description: "NVIDIA — GPU, CUDA" },
  { handle: "LangChainAI", category: "company", description: "LangChain — LLM orchestration" },
  { handle: "llama_index", category: "company", description: "LlamaIndex — RAG framework" },
  { handle: "modal_labs", category: "company", description: "Modal — serverless GPU infra" },
  { handle: "replicatehq", category: "company", description: "Replicate — model hosting" },
  { handle: "vercel", category: "company", description: "Vercel — AI SDK" },

  // Media / News
  { handle: "TheAIGRID", category: "media", description: "AI news aggregator" },
  { handle: "ai_explained_", category: "media", description: "AI Explained — analysis" },

  // Open Source
  { handle: "ggerganov", category: "oss", description: "llama.cpp creator" },
  { handle: "OlssonOllama", category: "oss", description: "Ollama — local LLM runtime" },
  { handle: "vaborellm_project", category: "oss", description: "vLLM — inference engine" },

  // Orgs / Standards
  { handle: "AssocCompMach", category: "org", description: "Association for Computing Machinery" },
  { handle: "NeurIPSConf", category: "org", description: "NeurIPS conference" },
];
