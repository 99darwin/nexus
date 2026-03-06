import type { Vertical, NodeType, NodeStatus, RelationshipType, EventType } from "./types.js";

export type Ring = "core" | "inner" | "mid" | "outer" | "distributed" | "periphery";

export interface VerticalMeta {
  vertical: Vertical;
  label: string;
  ring: Ring;
  color: string;
  angle: number;
}

export const VERTICAL_RING_STIFFNESS: Record<Ring, number> = {
  core: 0.3,
  inner: 0.2,
  mid: 0.15,
  outer: 0.1,
  distributed: 0.08,
  periphery: 0.05,
};

export const VERTICALS: VerticalMeta[] = [
  // Core
  {
    vertical: "foundation_models",
    label: "Foundation Models",
    ring: "core",
    color: "#e63946",
    angle: 0,
  },
  // Inner ring — evenly spaced
  { vertical: "inference", label: "Inference", ring: "inner", color: "#f4a261", angle: 0 },
  { vertical: "training", label: "Training", ring: "inner", color: "#e76f51", angle: 72 },
  { vertical: "agents", label: "Agents", ring: "inner", color: "#2a9d8f", angle: 144 },
  {
    vertical: "code_generation",
    label: "Code Generation",
    ring: "inner",
    color: "#264653",
    angle: 216,
  },
  { vertical: "multimodal", label: "Multimodal", ring: "inner", color: "#a855f7", angle: 288 },
  // Mid ring
  {
    vertical: "safety_alignment",
    label: "Safety & Alignment",
    ring: "mid",
    color: "#ef4444",
    angle: 0,
  },
  { vertical: "evaluation", label: "Evaluation", ring: "mid", color: "#f97316", angle: 60 },
  {
    vertical: "developer_tooling",
    label: "Developer Tooling",
    ring: "mid",
    color: "#06b6d4",
    angle: 120,
  },
  {
    vertical: "enterprise_platforms",
    label: "Enterprise Platforms",
    ring: "mid",
    color: "#8b5cf6",
    angle: 180,
  },
  {
    vertical: "data_infrastructure",
    label: "Data Infrastructure",
    ring: "mid",
    color: "#14b8a6",
    angle: 240,
  },
  { vertical: "open_source", label: "Open Source", ring: "mid", color: "#22c55e", angle: 300 },
  // Outer ring
  { vertical: "hardware", label: "Hardware", ring: "outer", color: "#6366f1", angle: 0 },
  {
    vertical: "consumer_products",
    label: "Consumer Products",
    ring: "outer",
    color: "#ec4899",
    angle: 51,
  },
  {
    vertical: "creative_tools",
    label: "Creative Tools",
    ring: "outer",
    color: "#d946ef",
    angle: 103,
  },
  {
    vertical: "search_retrieval",
    label: "Search & Retrieval",
    ring: "outer",
    color: "#0ea5e9",
    angle: 154,
  },
  { vertical: "robotics", label: "Robotics", ring: "outer", color: "#84cc16", angle: 206 },
  { vertical: "healthcare", label: "Healthcare", ring: "outer", color: "#10b981", angle: 257 },
  { vertical: "finance", label: "Finance", ring: "outer", color: "#f59e0b", angle: 309 },
  // Distributed / Periphery
  { vertical: "research", label: "Research", ring: "distributed", color: "#3b82f6", angle: 0 },
  {
    vertical: "governance_policy",
    label: "Governance & Policy",
    ring: "periphery",
    color: "#78716c",
    angle: 180,
  },
];

export const RING_RADIUS: Record<Ring, number> = {
  core: 0,
  inner: 150,
  mid: 300,
  outer: 450,
  distributed: 350,
  periphery: 550,
};

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

export const RELATIONSHIP_TYPES: RelationshipType[] = [
  "built_on",
  "competes_with",
  "forked_from",
  "integrates_with",
  "acquired_by",
  "funded_by",
  "authored_by",
  "benchmarked_on",
  "succeeded_by",
  "part_of",
  "inspired_by",
  "partners_with",
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

export const VISUAL = {
  NODE_SIZE_MIN: 4,
  NODE_SIZE_MAX: 40,
  NODE_OPACITY_FRESH: 1.0,
  NODE_OPACITY_STALE: 0.3,
  NODE_STALE_DAYS: 90,
  EDGE_WIDTH_MIN: 1,
  EDGE_WIDTH_MAX: 4,
  CONFIDENCE_THRESHOLD: 0.5,
} as const;
