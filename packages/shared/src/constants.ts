import type { Vertical, NodeType, NodeStatus, EventType } from "./types.js";

export interface VerticalMeta {
  vertical: Vertical;
  label: string;
  color: string;
}

export const VERTICALS: VerticalMeta[] = [
  { vertical: "foundation_models", label: "Foundation Models", color: "#e63946" },
  { vertical: "inference", label: "Inference", color: "#f4a261" },
  { vertical: "training", label: "Training", color: "#e76f51" },
  { vertical: "agents", label: "Agents", color: "#2a9d8f" },
  { vertical: "code_generation", label: "Code Generation", color: "#264653" },
  { vertical: "multimodal", label: "Multimodal", color: "#a855f7" },
  { vertical: "safety_alignment", label: "Safety & Alignment", color: "#ef4444" },
  { vertical: "evaluation", label: "Evaluation", color: "#f97316" },
  { vertical: "developer_tooling", label: "Developer Tooling", color: "#06b6d4" },
  { vertical: "enterprise_platforms", label: "Enterprise Platforms", color: "#8b5cf6" },
  { vertical: "data_infrastructure", label: "Data Infrastructure", color: "#14b8a6" },
  { vertical: "open_source", label: "Open Source", color: "#22c55e" },
  { vertical: "hardware", label: "Hardware", color: "#6366f1" },
  { vertical: "consumer_products", label: "Consumer Products", color: "#ec4899" },
  { vertical: "creative_tools", label: "Creative Tools", color: "#d946ef" },
  { vertical: "search_retrieval", label: "Search & Retrieval", color: "#0ea5e9" },
  { vertical: "robotics", label: "Robotics", color: "#84cc16" },
  { vertical: "healthcare", label: "Healthcare", color: "#10b981" },
  { vertical: "finance", label: "Finance", color: "#f59e0b" },
  { vertical: "research", label: "Research", color: "#3b82f6" },
  { vertical: "governance_policy", label: "Governance & Policy", color: "#78716c" },
];

export const NODE_TYPES: NodeType[] = [
  "model",
  "product",
  "company",
  "paper",
  "person",
  "framework",
  "dataset",
  "benchmark",
  "standard",
  "initiative",
];

export const NODE_STATUSES: NodeStatus[] = [
  "announced",
  "alpha",
  "beta",
  "ga",
  "deprecated",
  "acquired",
  "shutdown",
];

export const EVENT_TYPES: EventType[] = [
  "launch",
  "funding",
  "release",
  "acquisition",
  "paper",
  "update",
  "shutdown",
];

export const SIGNIFICANCE = {
  FRONTIER: 0.9,
  HIGH: 0.7,
  MEDIUM: 0.5,
  LOW: 0.3,
  NOISE: 0.1,
} as const;
