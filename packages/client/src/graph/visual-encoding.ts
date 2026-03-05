const VERTICAL_COLORS: Record<string, string> = {
  foundation_models: "#8a3540",   // was #e63946
  inference: "#9a7650",           // was #f4a261
  training: "#8a5545",           // was #e76f51
  agents: "#2a7068",             // was #2a9d8f
  code_generation: "#3a8a82",    // was #4ecdc4
  multimodal: "#7048a0",         // was #a855f7
  safety_alignment: "#8a4040",   // was #ef4444
  evaluation: "#9a5a20",         // was #f97316
  developer_tooling: "#1a7a90",  // was #06b6d4
  enterprise_platforms: "#6048a0", // was #8b5cf6
  data_infrastructure: "#1a8070", // was #14b8a6
  open_source: "#2a7a45",        // was #22c55e
  hardware: "#4a50a0",           // was #6366f1
  consumer_products: "#9a4070",  // was #ec4899
  creative_tools: "#8a40a0",     // was #d946ef
  search_retrieval: "#1a70a0",   // was #0ea5e9
  robotics: "#5a8020",           // was #84cc16
  healthcare: "#1a7a58",         // was #10b981
  finance: "#9a7020",            // was #f59e0b
  research: "#3a68a0",           // was #3b82f6
  governance_policy: "#585550",  // was #78716c
};

const RELATIONSHIP_COLORS: Record<string, string> = {
  built_on: "#3a6a80",       // was #4a9eff
  competes_with: "#804848",  // was #ff6b6b
  forked_from: "#806838",    // was #ffa94d
  integrates_with: "#388048", // was #51cf66
  acquired_by: "#784080",    // was #cc5de8
  funded_by: "#807830",      // was #ffd43b
  authored_by: "#486880",    // was #74c0fc
  benchmarked_on: "#505860", // was #868e96
  succeeded_by: "#1a7a60",   // was #20c997
  part_of: "#607838",        // was #a9e34b
  inspired_by: "#806090",    // was #e599f7
  partners_with: "#2a8068",  // was #38d9a9
};

const NODE_SIZE_MIN = 4;
const NODE_SIZE_MAX = 40;
const STALE_DAYS = 90;

export function nodeSize(significance: number): number {
  const clamped = Math.max(0.05, Math.min(1, significance));
  return NODE_SIZE_MIN + (NODE_SIZE_MAX - NODE_SIZE_MIN) * Math.log10(1 + clamped * 9);
}

export function nodeColor(vertical: string): string {
  return VERTICAL_COLORS[vertical] ?? "#888888";
}

export function nodeOpacity(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays <= 1) return 1.0;
  if (ageDays >= STALE_DAYS) return 0.3;
  return 1.0 - (ageDays / STALE_DAYS) * 0.7;
}

export function edgeWidth(confidence: number): number {
  return 1 + confidence * 3;
}

export function edgeColor(relationship: string): string {
  return RELATIONSHIP_COLORS[relationship] ?? "#555555";
}

export { VERTICAL_COLORS };
