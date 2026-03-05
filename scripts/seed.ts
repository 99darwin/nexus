import type { GraphNode, GraphEdge } from "@nexus/shared";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const now = "2026-03-01T00:00:00Z";

// ── Companies (12) ──────────────────────────────────────────────────
const companies: GraphNode[] = [
  {
    id: "openai",
    type: "company",
    name: "OpenAI",
    vertical: "foundation_models",
    verticals_secondary: ["agents", "consumer_products"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2023-03-14T00:00:00Z", event_type: "launch", summary: "GPT-4 released", source_url: "https://openai.com/gpt-4" }],
    significance: 0.98,
    summary: "AI research lab and creator of GPT models and ChatGPT.",
    metadata: { founded: 2015, hq: "San Francisco" },
  },
  {
    id: "anthropic",
    type: "company",
    name: "Anthropic",
    vertical: "foundation_models",
    verticals_secondary: ["safety_alignment", "agents"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-03-04T00:00:00Z", event_type: "launch", summary: "Claude 3 family launched", source_url: "https://anthropic.com/claude-3" }],
    significance: 0.95,
    summary: "AI safety company building the Claude model family.",
    metadata: { founded: 2021, hq: "San Francisco" },
  },
  {
    id: "google-deepmind",
    type: "company",
    name: "Google DeepMind",
    vertical: "foundation_models",
    verticals_secondary: ["research", "multimodal"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2023-12-06T00:00:00Z", event_type: "launch", summary: "Gemini model family announced", source_url: "https://deepmind.google/gemini" }],
    significance: 0.95,
    summary: "Google's unified AI research lab combining DeepMind and Google Brain.",
    metadata: { founded: 2023, hq: "London" },
  },
  {
    id: "meta-ai",
    type: "company",
    name: "Meta AI",
    vertical: "foundation_models",
    verticals_secondary: ["open_source", "research"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-04-18T00:00:00Z", event_type: "launch", summary: "Llama 3 released", source_url: "https://ai.meta.com/llama3" }],
    significance: 0.9,
    summary: "Meta's AI research division, creators of Llama open-weight models.",
    metadata: { hq: "Menlo Park" },
  },
  {
    id: "mistral",
    type: "company",
    name: "Mistral AI",
    vertical: "foundation_models",
    verticals_secondary: ["open_source", "inference"],
    status: "ga",
    discovered_at: "2023-06-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-02-26T00:00:00Z", event_type: "launch", summary: "Mistral Large released", source_url: "https://mistral.ai/news/mistral-large" }],
    significance: 0.8,
    summary: "French AI startup building open and commercial frontier models.",
    metadata: { founded: 2023, hq: "Paris" },
  },
  {
    id: "nvidia",
    type: "company",
    name: "NVIDIA",
    vertical: "hardware",
    verticals_secondary: ["training", "inference"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-03-18T00:00:00Z", event_type: "launch", summary: "B200 GPU announced at GTC", source_url: "https://nvidia.com/gtc" }],
    significance: 0.95,
    summary: "Dominant GPU manufacturer powering AI training and inference.",
    metadata: { founded: 1993, hq: "Santa Clara" },
  },
  {
    id: "microsoft",
    type: "company",
    name: "Microsoft",
    vertical: "enterprise_platforms",
    verticals_secondary: ["code_generation", "consumer_products"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2023-02-07T00:00:00Z", event_type: "launch", summary: "AI-powered Bing and Copilot announced", source_url: "https://blogs.microsoft.com/blog/2023/02/07/reinventing-search-with-a-new-ai-powered-microsoft-bing-and-edge-your-copilot-for-the-web/" }],
    significance: 0.9,
    summary: "Major tech company with deep AI integration across products via OpenAI partnership.",
    metadata: { hq: "Redmond" },
  },
  {
    id: "google",
    type: "company",
    name: "Google",
    vertical: "enterprise_platforms",
    verticals_secondary: ["search_retrieval", "consumer_products"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-05-14T00:00:00Z", event_type: "launch", summary: "AI Overviews launched in Search", source_url: "https://blog.google/products/search/generative-ai-google-search-may-2024/" }],
    significance: 0.9,
    summary: "Parent company of DeepMind, integrating AI across search, cloud, and products.",
    metadata: { hq: "Mountain View" },
  },
  {
    id: "xai",
    type: "company",
    name: "xAI",
    vertical: "foundation_models",
    verticals_secondary: ["consumer_products"],
    status: "ga",
    discovered_at: "2023-07-12T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-03-17T00:00:00Z", event_type: "launch", summary: "Grok-1.5 released", source_url: "https://x.ai/blog/grok-1.5" }],
    significance: 0.7,
    summary: "Elon Musk's AI company building the Grok model series.",
    metadata: { founded: 2023, hq: "Austin" },
  },
  {
    id: "cohere",
    type: "company",
    name: "Cohere",
    vertical: "enterprise_platforms",
    verticals_secondary: ["search_retrieval", "foundation_models"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-04-04T00:00:00Z", event_type: "launch", summary: "Command R+ released", source_url: "https://cohere.com/blog/command-r-plus" }],
    significance: 0.65,
    summary: "Enterprise-focused AI company with RAG-optimized models.",
    metadata: { founded: 2019, hq: "Toronto" },
  },
  {
    id: "stability-ai",
    type: "company",
    name: "Stability AI",
    vertical: "creative_tools",
    verticals_secondary: ["open_source", "multimodal"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-02-22T00:00:00Z", event_type: "launch", summary: "Stable Diffusion 3 announced", source_url: "https://stability.ai/news/stable-diffusion-3" }],
    significance: 0.65,
    summary: "Open-source generative AI company behind Stable Diffusion.",
    metadata: { founded: 2020, hq: "London" },
  },
  {
    id: "huggingface",
    type: "company",
    name: "Hugging Face",
    vertical: "open_source",
    verticals_secondary: ["developer_tooling", "data_infrastructure"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-08-01T00:00:00Z", event_type: "update", summary: "Surpassed 1M models on the Hub", source_url: "https://huggingface.co/blog" }],
    significance: 0.85,
    summary: "The GitHub of machine learning — hosts models, datasets, and Spaces.",
    metadata: { founded: 2016, hq: "New York" },
  },
];

// ── Models (15) ─────────────────────────────────────────────────────
const models: GraphNode[] = [
  {
    id: "openai/gpt-4o",
    type: "model",
    name: "GPT-4o",
    vertical: "foundation_models",
    verticals_secondary: ["multimodal"],
    status: "ga",
    discovered_at: "2024-05-13T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-05-13T00:00:00Z", event_type: "launch", summary: "GPT-4o launched with native multimodal capabilities", source_url: "https://openai.com/index/hello-gpt-4o/" }],
    significance: 0.92,
    summary: "OpenAI's flagship multimodal model with native audio, vision, and text.",
    metadata: { modality: "text,vision,audio", context_window: 128000 },
  },
  {
    id: "openai/gpt-4",
    type: "model",
    name: "GPT-4",
    vertical: "foundation_models",
    verticals_secondary: [],
    status: "ga",
    discovered_at: "2023-03-14T00:00:00Z",
    updated_at: "2024-05-13T00:00:00Z",
    events: [{ timestamp: "2023-03-14T00:00:00Z", event_type: "launch", summary: "GPT-4 released", source_url: "https://openai.com/research/gpt-4" }],
    significance: 0.85,
    summary: "OpenAI's breakthrough large language model.",
    metadata: { context_window: 8192 },
  },
  {
    id: "openai/o1",
    type: "model",
    name: "o1",
    vertical: "foundation_models",
    verticals_secondary: ["agents"],
    status: "ga",
    discovered_at: "2024-09-12T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-09-12T00:00:00Z", event_type: "launch", summary: "o1 reasoning model released", source_url: "https://openai.com/o1" }],
    significance: 0.88,
    summary: "OpenAI's reasoning-focused model with chain-of-thought capabilities.",
    metadata: { modality: "text", reasoning: true },
  },
  {
    id: "anthropic/claude-4-opus",
    type: "model",
    name: "Claude 4 Opus",
    vertical: "foundation_models",
    verticals_secondary: ["agents", "code_generation"],
    status: "ga",
    discovered_at: "2025-05-22T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2025-05-22T00:00:00Z", event_type: "launch", summary: "Claude 4 Opus released as most capable model", source_url: "https://anthropic.com/claude-4" }],
    significance: 0.93,
    summary: "Anthropic's most capable model with deep reasoning and agentic capabilities.",
    metadata: { context_window: 200000 },
  },
  {
    id: "anthropic/claude-4-sonnet",
    type: "model",
    name: "Claude 4 Sonnet",
    vertical: "foundation_models",
    verticals_secondary: ["code_generation"],
    status: "ga",
    discovered_at: "2025-05-22T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2025-05-22T00:00:00Z", event_type: "launch", summary: "Claude 4 Sonnet released", source_url: "https://anthropic.com/claude-4" }],
    significance: 0.88,
    summary: "Anthropic's balanced performance/cost model in the Claude 4 family.",
    metadata: { context_window: 200000 },
  },
  {
    id: "anthropic/claude-4-haiku",
    type: "model",
    name: "Claude 4 Haiku",
    vertical: "foundation_models",
    verticals_secondary: ["inference"],
    status: "ga",
    discovered_at: "2025-06-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2025-06-01T00:00:00Z", event_type: "launch", summary: "Claude 4 Haiku released for fast inference", source_url: "https://anthropic.com/claude-4-haiku" }],
    significance: 0.75,
    summary: "Anthropic's fastest and most cost-efficient Claude 4 model.",
    metadata: { context_window: 200000 },
  },
  {
    id: "anthropic/claude-3-5-sonnet",
    type: "model",
    name: "Claude 3.5 Sonnet",
    vertical: "foundation_models",
    verticals_secondary: ["code_generation"],
    status: "ga",
    discovered_at: "2024-06-20T00:00:00Z",
    updated_at: "2025-05-22T00:00:00Z",
    events: [{ timestamp: "2024-06-20T00:00:00Z", event_type: "launch", summary: "Claude 3.5 Sonnet released", source_url: "https://anthropic.com/claude-3-5-sonnet" }],
    significance: 0.8,
    summary: "Highly capable model that set new benchmarks for coding tasks.",
    metadata: { context_window: 200000 },
  },
  {
    id: "google/gemini-2-5-pro",
    type: "model",
    name: "Gemini 2.5 Pro",
    vertical: "foundation_models",
    verticals_secondary: ["multimodal", "agents"],
    status: "ga",
    discovered_at: "2025-03-25T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2025-03-25T00:00:00Z", event_type: "launch", summary: "Gemini 2.5 Pro released with thinking capabilities", source_url: "https://deepmind.google/technologies/gemini/2-5-pro/" }],
    significance: 0.9,
    summary: "Google DeepMind's thinking model with 1M context window.",
    metadata: { context_window: 1000000, modality: "text,vision,audio,video" },
  },
  {
    id: "meta/llama-4",
    type: "model",
    name: "Llama 4",
    vertical: "foundation_models",
    verticals_secondary: ["open_source"],
    status: "ga",
    discovered_at: "2025-04-05T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2025-04-05T00:00:00Z", event_type: "launch", summary: "Llama 4 released as open-weight model", source_url: "https://ai.meta.com/llama4" }],
    significance: 0.88,
    summary: "Meta's latest open-weight model family with mixture-of-experts architecture.",
    metadata: { open_weight: true },
  },
  {
    id: "meta/llama-3",
    type: "model",
    name: "Llama 3",
    vertical: "foundation_models",
    verticals_secondary: ["open_source"],
    status: "ga",
    discovered_at: "2024-04-18T00:00:00Z",
    updated_at: "2025-04-05T00:00:00Z",
    events: [{ timestamp: "2024-04-18T00:00:00Z", event_type: "launch", summary: "Llama 3 released", source_url: "https://ai.meta.com/blog/meta-llama-3/" }],
    significance: 0.78,
    summary: "Meta's open-weight model family with 8B and 70B variants.",
    metadata: { open_weight: true },
  },
  {
    id: "mistral/mistral-large",
    type: "model",
    name: "Mistral Large",
    vertical: "foundation_models",
    verticals_secondary: [],
    status: "ga",
    discovered_at: "2024-02-26T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-02-26T00:00:00Z", event_type: "launch", summary: "Mistral Large released", source_url: "https://mistral.ai/news/mistral-large" }],
    significance: 0.7,
    summary: "Mistral's flagship commercial model.",
    metadata: {},
  },
  {
    id: "google/gemini-1-5-pro",
    type: "model",
    name: "Gemini 1.5 Pro",
    vertical: "foundation_models",
    verticals_secondary: ["multimodal"],
    status: "ga",
    discovered_at: "2024-02-15T00:00:00Z",
    updated_at: "2025-03-25T00:00:00Z",
    events: [{ timestamp: "2024-02-15T00:00:00Z", event_type: "launch", summary: "Gemini 1.5 Pro with 1M context", source_url: "https://deepmind.google/technologies/gemini/" }],
    significance: 0.78,
    summary: "Google's million-token context window model.",
    metadata: { context_window: 1000000 },
  },
  {
    id: "xai/grok-2",
    type: "model",
    name: "Grok-2",
    vertical: "foundation_models",
    verticals_secondary: [],
    status: "ga",
    discovered_at: "2024-08-13T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-08-13T00:00:00Z", event_type: "launch", summary: "Grok-2 released", source_url: "https://x.ai/blog/grok-2" }],
    significance: 0.6,
    summary: "xAI's second-generation language model.",
    metadata: {},
  },
  {
    id: "stability-ai/sd3",
    type: "model",
    name: "Stable Diffusion 3",
    vertical: "creative_tools",
    verticals_secondary: ["multimodal", "open_source"],
    status: "ga",
    discovered_at: "2024-02-22T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-06-12T00:00:00Z", event_type: "launch", summary: "SD3 Medium weights released", source_url: "https://stability.ai/news/stable-diffusion-3-medium" }],
    significance: 0.7,
    summary: "Stability AI's text-to-image diffusion model with MMDiT architecture.",
    metadata: { modality: "text-to-image" },
  },
  {
    id: "openai/dall-e-3",
    type: "model",
    name: "DALL-E 3",
    vertical: "creative_tools",
    verticals_secondary: ["multimodal"],
    status: "ga",
    discovered_at: "2023-10-03T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2023-10-03T00:00:00Z", event_type: "launch", summary: "DALL-E 3 released integrated with ChatGPT", source_url: "https://openai.com/dall-e-3" }],
    significance: 0.72,
    summary: "OpenAI's text-to-image generation model with superior prompt understanding.",
    metadata: { modality: "text-to-image" },
  },
];

// ── Products (8) ────────────────────────────────────────────────────
const products: GraphNode[] = [
  {
    id: "openai/chatgpt",
    type: "product",
    name: "ChatGPT",
    vertical: "consumer_products",
    verticals_secondary: ["agents"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2023-11-06T00:00:00Z", event_type: "update", summary: "GPTs custom chatbot platform launched", source_url: "https://openai.com/blog/introducing-gpts" }],
    significance: 0.95,
    summary: "OpenAI's consumer AI chatbot product, most widely used AI app globally.",
    metadata: { mau: "200M+" },
  },
  {
    id: "anthropic/claude-code",
    type: "product",
    name: "Claude Code",
    vertical: "code_generation",
    verticals_secondary: ["agents", "developer_tooling"],
    status: "ga",
    discovered_at: "2025-02-24T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2025-02-24T00:00:00Z", event_type: "launch", summary: "Claude Code launched as agentic coding CLI", source_url: "https://anthropic.com/claude-code" }],
    significance: 0.78,
    summary: "Anthropic's agentic coding tool that operates in the terminal.",
    metadata: { open_source: false },
  },
  {
    id: "github/copilot",
    type: "product",
    name: "GitHub Copilot",
    vertical: "code_generation",
    verticals_secondary: ["developer_tooling"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-02-09T00:00:00Z", event_type: "update", summary: "Copilot Workspace preview announced", source_url: "https://github.blog/2024-04-29-github-copilot-workspace/" }],
    significance: 0.85,
    summary: "GitHub's AI pair programmer integrated into IDEs.",
    metadata: { subscribers: "1.8M+" },
  },
  {
    id: "cursor",
    type: "product",
    name: "Cursor",
    vertical: "code_generation",
    verticals_secondary: ["developer_tooling", "agents"],
    status: "ga",
    discovered_at: "2023-06-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-09-01T00:00:00Z", event_type: "update", summary: "Cursor reached $100M ARR", source_url: "https://www.cursor.com" }],
    significance: 0.78,
    summary: "AI-first code editor built on VS Code with deep model integration.",
    metadata: {},
  },
  {
    id: "perplexity",
    type: "product",
    name: "Perplexity",
    vertical: "search_retrieval",
    verticals_secondary: ["consumer_products"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-04-01T00:00:00Z", event_type: "funding", summary: "Series B at $1B valuation", source_url: "https://www.perplexity.ai" }],
    significance: 0.75,
    summary: "AI-powered search engine with cited answers.",
    metadata: {},
  },
  {
    id: "midjourney",
    type: "product",
    name: "Midjourney",
    vertical: "creative_tools",
    verticals_secondary: ["consumer_products"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-06-01T00:00:00Z", event_type: "update", summary: "Midjourney v6.1 released with improved coherence", source_url: "https://www.midjourney.com" }],
    significance: 0.75,
    summary: "Leading AI image generation platform accessible via Discord and web.",
    metadata: {},
  },
  {
    id: "openai/sora",
    type: "product",
    name: "Sora",
    vertical: "creative_tools",
    verticals_secondary: ["multimodal"],
    status: "ga",
    discovered_at: "2024-02-15T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-12-09T00:00:00Z", event_type: "launch", summary: "Sora launched for ChatGPT Pro/Plus users", source_url: "https://openai.com/sora" }],
    significance: 0.8,
    summary: "OpenAI's text-to-video generation model.",
    metadata: { modality: "text-to-video" },
  },
  {
    id: "google/notebooklm",
    type: "product",
    name: "NotebookLM",
    vertical: "consumer_products",
    verticals_secondary: ["search_retrieval"],
    status: "ga",
    discovered_at: "2023-07-12T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-09-26T00:00:00Z", event_type: "update", summary: "Audio Overview feature launched", source_url: "https://blog.google/technology/ai/notebooklm-audio-overviews/" }],
    significance: 0.6,
    summary: "Google's AI research and note-taking assistant powered by Gemini.",
    metadata: {},
  },
];

// ── Frameworks (5) ──────────────────────────────────────────────────
const frameworks: GraphNode[] = [
  {
    id: "langchain",
    type: "framework",
    name: "LangChain",
    vertical: "developer_tooling",
    verticals_secondary: ["agents"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-01-08T00:00:00Z", event_type: "update", summary: "LangChain v0.1 stable release", source_url: "https://blog.langchain.dev/langchain-v0-1-0/" }],
    significance: 0.78,
    summary: "Popular framework for building LLM-powered applications and agents.",
    metadata: { language: "python,javascript" },
  },
  {
    id: "huggingface/transformers",
    type: "framework",
    name: "Transformers",
    vertical: "developer_tooling",
    verticals_secondary: ["open_source", "training"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-06-01T00:00:00Z", event_type: "update", summary: "Transformers v4.41 with Gemma 2 support", source_url: "https://github.com/huggingface/transformers" }],
    significance: 0.88,
    summary: "The de facto standard library for pretrained transformer models.",
    metadata: { language: "python", github_stars: "130k+" },
  },
  {
    id: "vllm",
    type: "framework",
    name: "vLLM",
    vertical: "inference",
    verticals_secondary: ["open_source"],
    status: "ga",
    discovered_at: "2023-06-20T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-01-01T00:00:00Z", event_type: "update", summary: "vLLM v0.3 with speculative decoding", source_url: "https://github.com/vllm-project/vllm" }],
    significance: 0.75,
    summary: "High-throughput LLM serving engine with PagedAttention.",
    metadata: { language: "python" },
  },
  {
    id: "pytorch",
    type: "framework",
    name: "PyTorch",
    vertical: "training",
    verticals_secondary: ["developer_tooling", "research"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-07-01T00:00:00Z", event_type: "update", summary: "PyTorch 2.4 released with updated torch.compile", source_url: "https://pytorch.org/blog/" }],
    significance: 0.92,
    summary: "Dominant deep learning framework used by most AI research labs.",
    metadata: { language: "python,c++", github_stars: "82k+" },
  },
  {
    id: "llamaindex",
    type: "framework",
    name: "LlamaIndex",
    vertical: "search_retrieval",
    verticals_secondary: ["developer_tooling"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-02-01T00:00:00Z", event_type: "update", summary: "LlamaIndex v0.10 with modular architecture", source_url: "https://www.llamaindex.ai" }],
    significance: 0.68,
    summary: "Data framework for connecting LLMs with external data sources.",
    metadata: { language: "python" },
  },
];

// ── Benchmarks (3) ──────────────────────────────────────────────────
const benchmarks: GraphNode[] = [
  {
    id: "mmlu",
    type: "benchmark",
    name: "MMLU",
    vertical: "evaluation",
    verticals_secondary: [],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2023-01-01T00:00:00Z", event_type: "launch", summary: "MMLU widely adopted as LLM benchmark", source_url: "https://arxiv.org/abs/2009.03300" }],
    significance: 0.7,
    summary: "Massive Multitask Language Understanding benchmark covering 57 subjects.",
    metadata: { subjects: 57 },
  },
  {
    id: "humaneval",
    type: "benchmark",
    name: "HumanEval",
    vertical: "evaluation",
    verticals_secondary: ["code_generation"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2023-01-01T00:00:00Z", event_type: "launch", summary: "HumanEval established as code gen benchmark", source_url: "https://arxiv.org/abs/2107.03374" }],
    significance: 0.65,
    summary: "OpenAI benchmark measuring code generation capability with 164 problems.",
    metadata: { problems: 164 },
  },
  {
    id: "swebench",
    type: "benchmark",
    name: "SWE-bench",
    vertical: "evaluation",
    verticals_secondary: ["code_generation", "agents"],
    status: "ga",
    discovered_at: "2023-10-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-04-01T00:00:00Z", event_type: "update", summary: "SWE-bench Verified released with human-validated subset", source_url: "https://www.swebench.com" }],
    significance: 0.72,
    summary: "Benchmark evaluating AI agents on real-world software engineering tasks.",
    metadata: {},
  },
];

// ── Papers (3) ──────────────────────────────────────────────────────
const papers: GraphNode[] = [
  {
    id: "paper/attention-is-all-you-need",
    type: "paper",
    name: "Attention Is All You Need",
    vertical: "research",
    verticals_secondary: ["foundation_models"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: "2023-01-01T00:00:00Z",
    events: [{ timestamp: "2017-06-12T00:00:00Z", event_type: "paper", summary: "Transformer architecture paper published", source_url: "https://arxiv.org/abs/1706.03762" }],
    significance: 0.98,
    summary: "The foundational paper introducing the Transformer architecture.",
    metadata: { citations: "100k+", authors: "Vaswani et al." },
  },
  {
    id: "paper/scaling-laws",
    type: "paper",
    name: "Scaling Laws for Neural Language Models",
    vertical: "research",
    verticals_secondary: ["training"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: "2023-01-01T00:00:00Z",
    events: [{ timestamp: "2020-01-23T00:00:00Z", event_type: "paper", summary: "Kaplan et al. scaling laws paper published", source_url: "https://arxiv.org/abs/2001.08361" }],
    significance: 0.85,
    summary: "Seminal paper establishing power-law relationships between model size, data, and performance.",
    metadata: { authors: "Kaplan et al." },
  },
  {
    id: "paper/constitutional-ai",
    type: "paper",
    name: "Constitutional AI",
    vertical: "safety_alignment",
    verticals_secondary: ["research"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: "2023-01-01T00:00:00Z",
    events: [{ timestamp: "2022-12-15T00:00:00Z", event_type: "paper", summary: "Constitutional AI paper published by Anthropic", source_url: "https://arxiv.org/abs/2212.08073" }],
    significance: 0.78,
    summary: "Anthropic's approach to training harmless AI assistants through self-supervision.",
    metadata: { authors: "Bai et al." },
  },
];

// ── Datasets (2) ────────────────────────────────────────────────────
const datasets: GraphNode[] = [
  {
    id: "dataset/the-pile",
    type: "dataset",
    name: "The Pile",
    vertical: "data_infrastructure",
    verticals_secondary: ["open_source"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: "2023-01-01T00:00:00Z",
    events: [{ timestamp: "2020-12-31T00:00:00Z", event_type: "launch", summary: "The Pile 825GB open dataset released", source_url: "https://pile.eleuther.ai" }],
    significance: 0.6,
    summary: "Large open-source language modeling dataset by EleutherAI.",
    metadata: { size: "825GB" },
  },
  {
    id: "dataset/common-crawl",
    type: "dataset",
    name: "Common Crawl",
    vertical: "data_infrastructure",
    verticals_secondary: [],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2023-01-01T00:00:00Z", event_type: "update", summary: "Ongoing monthly web crawl dataset", source_url: "https://commoncrawl.org" }],
    significance: 0.7,
    summary: "Massive open web crawl dataset used for training many LLMs.",
    metadata: { size: "petabytes" },
  },
];

// ── Standards/Initiatives (2) ───────────────────────────────────────
const standards: GraphNode[] = [
  {
    id: "eu-ai-act",
    type: "standard",
    name: "EU AI Act",
    vertical: "governance_policy",
    verticals_secondary: [],
    status: "ga",
    discovered_at: "2023-06-14T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-03-13T00:00:00Z", event_type: "update", summary: "EU AI Act formally approved by European Parliament", source_url: "https://www.europarl.europa.eu/topics/en/article/20230601STO93804/eu-ai-act-first-regulation-on-artificial-intelligence" }],
    significance: 0.8,
    summary: "First comprehensive legal framework for AI regulation worldwide.",
    metadata: { jurisdiction: "EU" },
  },
  {
    id: "nist-ai-rmf",
    type: "initiative",
    name: "NIST AI Risk Management Framework",
    vertical: "governance_policy",
    verticals_secondary: ["safety_alignment"],
    status: "ga",
    discovered_at: "2023-01-26T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2023-01-26T00:00:00Z", event_type: "launch", summary: "NIST AI RMF 1.0 published", source_url: "https://www.nist.gov/artificial-intelligence/executive-order-safe-secure-and-trustworthy-artificial-intelligence" }],
    significance: 0.6,
    summary: "US voluntary AI risk management guidelines by NIST.",
    metadata: { jurisdiction: "US" },
  },
];

// ── Hardware (additional) ───────────────────────────────────────────
const hardware: GraphNode[] = [
  {
    id: "nvidia/h100",
    type: "product",
    name: "NVIDIA H100",
    vertical: "hardware",
    verticals_secondary: ["training", "inference"],
    status: "ga",
    discovered_at: "2023-01-01T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2023-03-21T00:00:00Z", event_type: "launch", summary: "H100 became widely available", source_url: "https://nvidia.com/h100" }],
    significance: 0.9,
    summary: "NVIDIA's flagship data center GPU powering most AI training in 2023-2024.",
    metadata: { architecture: "Hopper", memory: "80GB HBM3" },
  },
  {
    id: "nvidia/b200",
    type: "product",
    name: "NVIDIA B200",
    vertical: "hardware",
    verticals_secondary: ["training", "inference"],
    status: "announced",
    discovered_at: "2024-03-18T00:00:00Z",
    updated_at: now,
    events: [{ timestamp: "2024-03-18T00:00:00Z", event_type: "launch", summary: "B200 GPU announced at GTC 2024", source_url: "https://nvidia.com/gtc" }],
    significance: 0.85,
    summary: "NVIDIA's next-gen Blackwell architecture GPU for AI workloads.",
    metadata: { architecture: "Blackwell", memory: "192GB HBM3e" },
  },
];

// ── Combine all nodes ───────────────────────────────────────────────
const nodes: GraphNode[] = [
  ...companies,
  ...models,
  ...products,
  ...frameworks,
  ...benchmarks,
  ...papers,
  ...datasets,
  ...standards,
  ...hardware,
];

// ── Edges (80+) ─────────────────────────────────────────────────────
const edges: GraphEdge[] = [
  // authored_by relationships
  { source_id: "openai/gpt-4o", target_id: "openai", relationship: "authored_by", discovered_at: "2024-05-13T00:00:00Z", confidence: 0.99, evidence: "GPT-4o created by OpenAI" },
  { source_id: "openai/gpt-4", target_id: "openai", relationship: "authored_by", discovered_at: "2023-03-14T00:00:00Z", confidence: 0.99, evidence: "GPT-4 created by OpenAI" },
  { source_id: "openai/o1", target_id: "openai", relationship: "authored_by", discovered_at: "2024-09-12T00:00:00Z", confidence: 0.99, evidence: "o1 created by OpenAI" },
  { source_id: "openai/chatgpt", target_id: "openai", relationship: "authored_by", discovered_at: "2023-01-01T00:00:00Z", confidence: 0.99, evidence: "ChatGPT is an OpenAI product" },
  { source_id: "openai/dall-e-3", target_id: "openai", relationship: "authored_by", discovered_at: "2023-10-03T00:00:00Z", confidence: 0.99, evidence: "DALL-E 3 created by OpenAI" },
  { source_id: "openai/sora", target_id: "openai", relationship: "authored_by", discovered_at: "2024-02-15T00:00:00Z", confidence: 0.99, evidence: "Sora created by OpenAI" },
  { source_id: "anthropic/claude-4-opus", target_id: "anthropic", relationship: "authored_by", discovered_at: "2025-05-22T00:00:00Z", confidence: 0.99, evidence: "Claude 4 Opus by Anthropic" },
  { source_id: "anthropic/claude-4-sonnet", target_id: "anthropic", relationship: "authored_by", discovered_at: "2025-05-22T00:00:00Z", confidence: 0.99, evidence: "Claude 4 Sonnet by Anthropic" },
  { source_id: "anthropic/claude-4-haiku", target_id: "anthropic", relationship: "authored_by", discovered_at: "2025-06-01T00:00:00Z", confidence: 0.99, evidence: "Claude 4 Haiku by Anthropic" },
  { source_id: "anthropic/claude-3-5-sonnet", target_id: "anthropic", relationship: "authored_by", discovered_at: "2024-06-20T00:00:00Z", confidence: 0.99, evidence: "Claude 3.5 Sonnet by Anthropic" },
  { source_id: "anthropic/claude-code", target_id: "anthropic", relationship: "authored_by", discovered_at: "2025-02-24T00:00:00Z", confidence: 0.99, evidence: "Claude Code by Anthropic" },
  { source_id: "google/gemini-2-5-pro", target_id: "google-deepmind", relationship: "authored_by", discovered_at: "2025-03-25T00:00:00Z", confidence: 0.99, evidence: "Gemini 2.5 Pro by Google DeepMind" },
  { source_id: "google/gemini-1-5-pro", target_id: "google-deepmind", relationship: "authored_by", discovered_at: "2024-02-15T00:00:00Z", confidence: 0.99, evidence: "Gemini 1.5 Pro by Google DeepMind" },
  { source_id: "google/notebooklm", target_id: "google", relationship: "authored_by", discovered_at: "2023-07-12T00:00:00Z", confidence: 0.99, evidence: "NotebookLM is a Google product" },
  { source_id: "meta/llama-4", target_id: "meta-ai", relationship: "authored_by", discovered_at: "2025-04-05T00:00:00Z", confidence: 0.99, evidence: "Llama 4 by Meta AI" },
  { source_id: "meta/llama-3", target_id: "meta-ai", relationship: "authored_by", discovered_at: "2024-04-18T00:00:00Z", confidence: 0.99, evidence: "Llama 3 by Meta AI" },
  { source_id: "mistral/mistral-large", target_id: "mistral", relationship: "authored_by", discovered_at: "2024-02-26T00:00:00Z", confidence: 0.99, evidence: "Mistral Large by Mistral AI" },
  { source_id: "xai/grok-2", target_id: "xai", relationship: "authored_by", discovered_at: "2024-08-13T00:00:00Z", confidence: 0.99, evidence: "Grok-2 by xAI" },
  { source_id: "stability-ai/sd3", target_id: "stability-ai", relationship: "authored_by", discovered_at: "2024-02-22T00:00:00Z", confidence: 0.99, evidence: "SD3 by Stability AI" },
  { source_id: "huggingface/transformers", target_id: "huggingface", relationship: "authored_by", discovered_at: "2023-01-01T00:00:00Z", confidence: 0.99, evidence: "Transformers library by Hugging Face" },
  { source_id: "paper/constitutional-ai", target_id: "anthropic", relationship: "authored_by", discovered_at: "2022-12-15T00:00:00Z", confidence: 0.99, evidence: "Constitutional AI paper by Anthropic researchers" },
  { source_id: "nvidia/h100", target_id: "nvidia", relationship: "authored_by", discovered_at: "2023-01-01T00:00:00Z", confidence: 0.99, evidence: "H100 manufactured by NVIDIA" },
  { source_id: "nvidia/b200", target_id: "nvidia", relationship: "authored_by", discovered_at: "2024-03-18T00:00:00Z", confidence: 0.99, evidence: "B200 manufactured by NVIDIA" },

  // succeeded_by chains
  { source_id: "openai/gpt-4", target_id: "openai/gpt-4o", relationship: "succeeded_by", discovered_at: "2024-05-13T00:00:00Z", confidence: 0.95, evidence: "GPT-4o succeeds GPT-4 as flagship model" },
  { source_id: "anthropic/claude-3-5-sonnet", target_id: "anthropic/claude-4-sonnet", relationship: "succeeded_by", discovered_at: "2025-05-22T00:00:00Z", confidence: 0.95, evidence: "Claude 4 Sonnet succeeds Claude 3.5 Sonnet" },
  { source_id: "google/gemini-1-5-pro", target_id: "google/gemini-2-5-pro", relationship: "succeeded_by", discovered_at: "2025-03-25T00:00:00Z", confidence: 0.95, evidence: "Gemini 2.5 Pro succeeds 1.5 Pro" },
  { source_id: "meta/llama-3", target_id: "meta/llama-4", relationship: "succeeded_by", discovered_at: "2025-04-05T00:00:00Z", confidence: 0.95, evidence: "Llama 4 succeeds Llama 3" },
  { source_id: "nvidia/h100", target_id: "nvidia/b200", relationship: "succeeded_by", discovered_at: "2024-03-18T00:00:00Z", confidence: 0.9, evidence: "B200 is the next-gen GPU after H100" },

  // built_on relationships
  { source_id: "openai/chatgpt", target_id: "openai/gpt-4o", relationship: "built_on", discovered_at: "2024-05-13T00:00:00Z", confidence: 0.95, evidence: "ChatGPT uses GPT-4o as default model" },
  { source_id: "anthropic/claude-code", target_id: "anthropic/claude-4-sonnet", relationship: "built_on", discovered_at: "2025-05-22T00:00:00Z", confidence: 0.9, evidence: "Claude Code uses Sonnet as default model" },
  { source_id: "google/notebooklm", target_id: "google/gemini-2-5-pro", relationship: "built_on", discovered_at: "2025-03-25T00:00:00Z", confidence: 0.85, evidence: "NotebookLM powered by Gemini" },
  { source_id: "perplexity", target_id: "openai/gpt-4o", relationship: "built_on", discovered_at: "2024-05-01T00:00:00Z", confidence: 0.7, evidence: "Perplexity uses multiple models including GPT-4o" },
  { source_id: "cursor", target_id: "anthropic/claude-4-sonnet", relationship: "built_on", discovered_at: "2025-05-22T00:00:00Z", confidence: 0.8, evidence: "Cursor integrates Claude Sonnet for coding" },
  { source_id: "cursor", target_id: "openai/gpt-4o", relationship: "built_on", discovered_at: "2024-05-13T00:00:00Z", confidence: 0.8, evidence: "Cursor also integrates GPT-4o" },

  // competes_with relationships
  { source_id: "openai/gpt-4o", target_id: "anthropic/claude-4-opus", relationship: "competes_with", discovered_at: "2025-05-22T00:00:00Z", confidence: 0.95, evidence: "Direct frontier model competitors" },
  { source_id: "openai/gpt-4o", target_id: "google/gemini-2-5-pro", relationship: "competes_with", discovered_at: "2025-03-25T00:00:00Z", confidence: 0.95, evidence: "Direct frontier model competitors" },
  { source_id: "anthropic/claude-4-opus", target_id: "google/gemini-2-5-pro", relationship: "competes_with", discovered_at: "2025-03-25T00:00:00Z", confidence: 0.9, evidence: "Competing frontier models" },
  { source_id: "openai/chatgpt", target_id: "perplexity", relationship: "competes_with", discovered_at: "2024-01-01T00:00:00Z", confidence: 0.7, evidence: "ChatGPT and Perplexity compete in AI-assisted search" },
  { source_id: "github/copilot", target_id: "cursor", relationship: "competes_with", discovered_at: "2024-01-01T00:00:00Z", confidence: 0.9, evidence: "Both are AI-powered coding tools" },
  { source_id: "github/copilot", target_id: "anthropic/claude-code", relationship: "competes_with", discovered_at: "2025-02-24T00:00:00Z", confidence: 0.8, evidence: "Both are AI coding assistants" },
  { source_id: "stability-ai/sd3", target_id: "openai/dall-e-3", relationship: "competes_with", discovered_at: "2024-02-22T00:00:00Z", confidence: 0.9, evidence: "Competing image generation models" },
  { source_id: "stability-ai/sd3", target_id: "midjourney", relationship: "competes_with", discovered_at: "2024-02-22T00:00:00Z", confidence: 0.85, evidence: "Competing image generation platforms" },
  { source_id: "meta/llama-4", target_id: "mistral/mistral-large", relationship: "competes_with", discovered_at: "2025-04-05T00:00:00Z", confidence: 0.8, evidence: "Competing in open-weight model space" },

  // part_of relationships
  { source_id: "google-deepmind", target_id: "google", relationship: "part_of", discovered_at: "2023-04-20T00:00:00Z", confidence: 0.99, evidence: "DeepMind is a division of Google/Alphabet" },
  { source_id: "anthropic/claude-4-opus", target_id: "anthropic/claude-4-sonnet", relationship: "part_of", discovered_at: "2025-05-22T00:00:00Z", confidence: 0.85, evidence: "Both part of Claude 4 model family" },
  { source_id: "anthropic/claude-4-haiku", target_id: "anthropic/claude-4-sonnet", relationship: "part_of", discovered_at: "2025-06-01T00:00:00Z", confidence: 0.85, evidence: "Both part of Claude 4 model family" },
  { source_id: "github/copilot", target_id: "microsoft", relationship: "part_of", discovered_at: "2023-01-01T00:00:00Z", confidence: 0.95, evidence: "GitHub Copilot is a Microsoft/GitHub product" },

  // funded_by relationships
  { source_id: "anthropic", target_id: "google", relationship: "funded_by", discovered_at: "2023-10-27T00:00:00Z", confidence: 0.99, evidence: "Google committed $2B investment in Anthropic" },
  { source_id: "openai", target_id: "microsoft", relationship: "funded_by", discovered_at: "2023-01-23T00:00:00Z", confidence: 0.99, evidence: "Microsoft invested $10B+ in OpenAI" },
  { source_id: "mistral", target_id: "microsoft", relationship: "funded_by", discovered_at: "2024-02-26T00:00:00Z", confidence: 0.9, evidence: "Microsoft invested in Mistral AI" },

  // partners_with relationships
  { source_id: "openai", target_id: "microsoft", relationship: "partners_with", discovered_at: "2023-01-01T00:00:00Z", confidence: 0.99, evidence: "Deep strategic partnership for Azure OpenAI Service" },
  { source_id: "anthropic", target_id: "google", relationship: "partners_with", discovered_at: "2023-10-27T00:00:00Z", confidence: 0.95, evidence: "Anthropic models available on Google Cloud" },

  // integrates_with relationships
  { source_id: "langchain", target_id: "openai/gpt-4o", relationship: "integrates_with", discovered_at: "2024-05-13T00:00:00Z", confidence: 0.95, evidence: "LangChain has official OpenAI integration" },
  { source_id: "langchain", target_id: "anthropic/claude-4-sonnet", relationship: "integrates_with", discovered_at: "2025-05-22T00:00:00Z", confidence: 0.95, evidence: "LangChain has official Anthropic integration" },
  { source_id: "llamaindex", target_id: "openai/gpt-4o", relationship: "integrates_with", discovered_at: "2024-05-13T00:00:00Z", confidence: 0.9, evidence: "LlamaIndex supports OpenAI models" },
  { source_id: "vllm", target_id: "meta/llama-4", relationship: "integrates_with", discovered_at: "2025-04-05T00:00:00Z", confidence: 0.9, evidence: "vLLM supports serving Llama models" },
  { source_id: "vllm", target_id: "mistral/mistral-large", relationship: "integrates_with", discovered_at: "2024-02-26T00:00:00Z", confidence: 0.85, evidence: "vLLM supports serving Mistral models" },

  // benchmarked_on relationships
  { source_id: "openai/gpt-4o", target_id: "mmlu", relationship: "benchmarked_on", discovered_at: "2024-05-13T00:00:00Z", confidence: 0.95, evidence: "GPT-4o evaluated on MMLU" },
  { source_id: "anthropic/claude-4-opus", target_id: "mmlu", relationship: "benchmarked_on", discovered_at: "2025-05-22T00:00:00Z", confidence: 0.95, evidence: "Claude 4 Opus evaluated on MMLU" },
  { source_id: "google/gemini-2-5-pro", target_id: "mmlu", relationship: "benchmarked_on", discovered_at: "2025-03-25T00:00:00Z", confidence: 0.95, evidence: "Gemini 2.5 Pro evaluated on MMLU" },
  { source_id: "openai/gpt-4o", target_id: "humaneval", relationship: "benchmarked_on", discovered_at: "2024-05-13T00:00:00Z", confidence: 0.9, evidence: "GPT-4o evaluated on HumanEval" },
  { source_id: "anthropic/claude-code", target_id: "swebench", relationship: "benchmarked_on", discovered_at: "2025-02-24T00:00:00Z", confidence: 0.9, evidence: "Claude Code evaluated on SWE-bench" },
  { source_id: "anthropic/claude-4-opus", target_id: "swebench", relationship: "benchmarked_on", discovered_at: "2025-05-22T00:00:00Z", confidence: 0.9, evidence: "Claude 4 Opus evaluated on SWE-bench" },

  // inspired_by relationships
  { source_id: "paper/constitutional-ai", target_id: "paper/scaling-laws", relationship: "inspired_by", discovered_at: "2022-12-15T00:00:00Z", confidence: 0.6, evidence: "Constitutional AI builds on insights from scaling research" },
  { source_id: "meta/llama-3", target_id: "paper/attention-is-all-you-need", relationship: "inspired_by", discovered_at: "2024-04-18T00:00:00Z", confidence: 0.95, evidence: "Llama uses transformer architecture" },
  { source_id: "openai/gpt-4", target_id: "paper/attention-is-all-you-need", relationship: "inspired_by", discovered_at: "2023-03-14T00:00:00Z", confidence: 0.95, evidence: "GPT-4 is a transformer model" },

  // forked_from relationships
  { source_id: "cursor", target_id: "github/copilot", relationship: "inspired_by", discovered_at: "2023-06-01T00:00:00Z", confidence: 0.7, evidence: "Cursor drew inspiration from Copilot's AI coding paradigm" },
  { source_id: "vllm", target_id: "huggingface/transformers", relationship: "built_on", discovered_at: "2023-06-20T00:00:00Z", confidence: 0.8, evidence: "vLLM builds on HuggingFace model loading" },

  // Training infrastructure
  { source_id: "openai/gpt-4o", target_id: "nvidia/h100", relationship: "built_on", discovered_at: "2024-05-13T00:00:00Z", confidence: 0.85, evidence: "GPT-4o trained on NVIDIA GPU clusters" },
  { source_id: "anthropic/claude-4-opus", target_id: "nvidia/h100", relationship: "built_on", discovered_at: "2025-05-22T00:00:00Z", confidence: 0.8, evidence: "Claude models trained on NVIDIA GPUs" },
  { source_id: "meta/llama-4", target_id: "nvidia/h100", relationship: "built_on", discovered_at: "2025-04-05T00:00:00Z", confidence: 0.85, evidence: "Llama 4 trained on NVIDIA GPU clusters" },
  { source_id: "meta/llama-4", target_id: "pytorch", relationship: "built_on", discovered_at: "2025-04-05T00:00:00Z", confidence: 0.95, evidence: "Llama models built with PyTorch" },
  { source_id: "huggingface/transformers", target_id: "pytorch", relationship: "built_on", discovered_at: "2023-01-01T00:00:00Z", confidence: 0.95, evidence: "Transformers library uses PyTorch as primary backend" },

  // Data relationships
  { source_id: "meta/llama-3", target_id: "dataset/common-crawl", relationship: "built_on", discovered_at: "2024-04-18T00:00:00Z", confidence: 0.85, evidence: "Llama 3 pre-training data includes Common Crawl" },

  // acquired_by relationships
  { source_id: "google-deepmind", target_id: "google", relationship: "acquired_by", discovered_at: "2023-04-20T00:00:00Z", confidence: 0.99, evidence: "DeepMind acquired by Google in 2014, merged with Brain in 2023" },

  // forked_from relationships
  { source_id: "vllm", target_id: "huggingface/transformers", relationship: "forked_from", discovered_at: "2023-06-20T00:00:00Z", confidence: 0.7, evidence: "vLLM originally forked model loading code from Transformers" },
  { source_id: "mistral/mistral-large", target_id: "meta/llama-3", relationship: "inspired_by", discovered_at: "2024-02-26T00:00:00Z", confidence: 0.5, evidence: "Mistral founders from Meta, influenced by Llama architecture" },
  { source_id: "llamaindex", target_id: "langchain", relationship: "inspired_by", discovered_at: "2023-01-01T00:00:00Z", confidence: 0.6, evidence: "LlamaIndex emerged in similar space as LangChain" },

  // Additional benchmarked_on
  { source_id: "meta/llama-4", target_id: "mmlu", relationship: "benchmarked_on", discovered_at: "2025-04-05T00:00:00Z", confidence: 0.95, evidence: "Llama 4 evaluated on MMLU" },
  { source_id: "anthropic/claude-4-sonnet", target_id: "humaneval", relationship: "benchmarked_on", discovered_at: "2025-05-22T00:00:00Z", confidence: 0.9, evidence: "Claude 4 Sonnet evaluated on HumanEval" },
  { source_id: "google/gemini-2-5-pro", target_id: "humaneval", relationship: "benchmarked_on", discovered_at: "2025-03-25T00:00:00Z", confidence: 0.9, evidence: "Gemini 2.5 Pro evaluated on HumanEval" },

  // Additional integrates_with
  { source_id: "langchain", target_id: "google/gemini-2-5-pro", relationship: "integrates_with", discovered_at: "2025-03-25T00:00:00Z", confidence: 0.9, evidence: "LangChain has Google GenAI integration" },
  { source_id: "cursor", target_id: "google/gemini-2-5-pro", relationship: "integrates_with", discovered_at: "2025-03-25T00:00:00Z", confidence: 0.75, evidence: "Cursor supports Gemini models" },

  // Additional competes_with
  { source_id: "langchain", target_id: "llamaindex", relationship: "competes_with", discovered_at: "2023-01-01T00:00:00Z", confidence: 0.75, evidence: "Both are LLM application frameworks" },
];

// ── Export seed data ────────────────────────────────────────────────
const seedData = { nodes, edges };

console.log(`Seed data: ${nodes.length} nodes, ${edges.length} edges`);

// Verify coverage
const verticalSet = new Set(nodes.map((n) => n.vertical));
console.log(`Verticals covered: ${verticalSet.size}`);

const relationshipSet = new Set(edges.map((e) => e.relationship));
console.log(`Relationship types: ${relationshipSet.size}/12`);

const typeSet = new Set(nodes.map((n) => n.type));
console.log(`Node types: ${typeSet.size}`);

// Write to client public directory for PoC
const clientPublicDir = join(__dirname, "..", "packages", "client", "public");
mkdirSync(clientPublicDir, { recursive: true });
writeFileSync(join(clientPublicDir, "seed-data.json"), JSON.stringify(seedData, null, 2));
console.log(`Wrote seed-data.json to ${clientPublicDir}`);

// If Neo4j is available, seed it
async function seedNeo4j() {
  let neo4j;
  try {
    neo4j = await import("neo4j-driver");
  } catch {
    console.log("neo4j-driver not available, skipping Neo4j seeding");
    return;
  }

  const uri = process.env.NEO4J_URI ?? "bolt://localhost:7687";
  const user = process.env.NEO4J_USER ?? "neo4j";
  const password = process.env.NEO4J_PASSWORD ?? "nexus-dev-password";

  const driver = neo4j.default.driver(uri, neo4j.default.auth.basic(user, password));
  const session = driver.session();

  try {
    // Clear existing data
    await session.run("MATCH (n) DETACH DELETE n");

    // Insert nodes
    for (const node of nodes) {
      await session.run(
        `CREATE (n:Entity {
          id: $id, type: $type, name: $name, vertical: $vertical,
          verticals_secondary: $verticals_secondary, status: $status,
          discovered_at: $discovered_at, updated_at: $updated_at,
          significance: $significance, summary: $summary,
          events: $events, metadata: $metadata
        })`,
        {
          ...node,
          events: JSON.stringify(node.events),
          metadata: JSON.stringify(node.metadata),
          verticals_secondary: node.verticals_secondary,
        },
      );
    }

    // Insert edges
    for (const edge of edges) {
      await session.run(
        `MATCH (a:Entity {id: $source_id}), (b:Entity {id: $target_id})
         CREATE (a)-[r:RELATES_TO {
           relationship: $relationship, discovered_at: $discovered_at,
           confidence: $confidence, evidence: $evidence
         }]->(b)`,
        edge,
      );
    }

    const nodeCount = await session.run("MATCH (n:Entity) RETURN count(n) as count");
    const edgeCount = await session.run("MATCH ()-[r:RELATES_TO]->() RETURN count(r) as count");
    console.log(`Neo4j seeded: ${nodeCount.records[0].get("count")} nodes, ${edgeCount.records[0].get("count")} edges`);
  } finally {
    await session.close();
    await driver.close();
  }
}

seedNeo4j().catch((err) => {
  console.error("Neo4j seeding failed:", err.message);
  console.log("Seed data was still written to seed-data.json");
});
