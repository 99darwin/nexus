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
  { handle: "karpathy", category: "researcher", description: "Andrej Karpathy — AI educator" },
  { handle: "jeffdean", category: "researcher", description: "Chief Scientist, Google DeepMind" },
  { handle: "fcaborhollet", category: "researcher", description: "Keras creator, ARC Prize" },
  { handle: "yanndubs", category: "researcher", description: "ML researcher" },
  { handle: "gdb", category: "researcher", description: "Greg Brockman — co-founder, OpenAI" },
  { handle: "rxwei", category: "researcher", description: "Richard Wei — ML compiler researcher" },
  { handle: "dakshgup", category: "researcher", description: "Daksh Gupta — AI developer" },

  // Companies
  { handle: "huggingface", category: "company", description: "Hugging Face — model hub" },
  { handle: "HuggingModels", category: "company", description: "Hugging Face — model updates" },
  { handle: "nvidia", category: "company", description: "NVIDIA — GPU, CUDA" },
  { handle: "LangChainAI", category: "company", description: "LangChain — LLM orchestration" },
  { handle: "llama_index", category: "company", description: "LlamaIndex — RAG framework" },
  { handle: "modal_labs", category: "company", description: "Modal — serverless GPU infra" },
  { handle: "replicatehq", category: "company", description: "Replicate — model hosting" },
  { handle: "vercel", category: "company", description: "Vercel — AI SDK" },
  { handle: "vercel_dev", category: "company", description: "Vercel — developer updates" },
  { handle: "Replit", category: "company", description: "Replit — AI-powered IDE" },
  { handle: "Alibaba_Qwen", category: "company", description: "Alibaba — Qwen models" },
  { handle: "antigravity", category: "company", description: "Antigravity — AI company" },

  // Media / News
  { handle: "TheAIGRID", category: "media", description: "AI news aggregator" },
  { handle: "ai_explained_", category: "media", description: "AI Explained — analysis" },

  // Open Source
  { handle: "ggerganov", category: "oss", description: "llama.cpp creator" },
  { handle: "OlssonOllama", category: "oss", description: "Ollama — local LLM runtime" },
  { handle: "vaborellm_project", category: "oss", description: "vLLM — inference engine" },
  { handle: "openclaw", category: "oss", description: "OpenClaw — open-source AI" },

  // Developers / Builders
  { handle: "beaversteever", category: "researcher", description: "AI developer" },
  { handle: "samuelrizzondev", category: "researcher", description: "AI developer" },
  { handle: "thsottiaux", category: "researcher", description: "AI developer" },
  { handle: "ClaudeCodeLog", category: "media", description: "Claude Code community logs" },
  { handle: "claudeai", category: "lab", description: "Claude AI official" },
  { handle: "dangreenheck", category: "researcher", description: "AI/game dev" },
  { handle: "OpenAIDevs", category: "lab", description: "OpenAI developer relations" },
  { handle: "nexxeln", category: "researcher", description: "Neel — developer, open source" },
  { handle: "DhravyaShah", category: "researcher", description: "Dhravya Shah — AI developer" },
  { handle: "dotta", category: "researcher", description: "Dotta — developer" },
  { handle: "noahzweben", category: "researcher", description: "Noah Zweben — AI developer" },
  { handle: "trq212", category: "researcher", description: "AI developer" },
  { handle: "ThePrimeagen", category: "media", description: "ThePrimeagen — dev content creator" },
  { handle: "bcherny", category: "researcher", description: "Boris Cherny — engineer, author" },
  { handle: "steipete", category: "researcher", description: "Peter Steinberger — developer" },
  { handle: "ivanburazin", category: "company", description: "Ivan Burazin — Daytona CEO" },
  { handle: "rauchg", category: "company", description: "Guillermo Rauch — Vercel CEO" },
  { handle: "zeke", category: "researcher", description: "Zeke Sikelianos — AI developer" },
  { handle: "ryancarson", category: "company", description: "Ryan Carson — tech entrepreneur" },

  // Orgs / Standards
  { handle: "AssocCompMach", category: "org", description: "Association for Computing Machinery" },
  { handle: "NeurIPSConf", category: "org", description: "NeurIPS conference" },
];
