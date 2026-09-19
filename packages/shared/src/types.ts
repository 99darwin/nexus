export type NodeType =
  | "model"
  | "product"
  | "company"
  | "paper"
  | "person"
  | "framework"
  | "dataset"
  | "benchmark"
  | "standard"
  | "initiative";

export type NodeStatus =
  | "announced"
  | "alpha"
  | "beta"
  | "ga"
  | "deprecated"
  | "acquired"
  | "shutdown";

export type Vertical =
  | "foundation_models"
  | "inference"
  | "training"
  | "agents"
  | "code_generation"
  | "multimodal"
  | "safety_alignment"
  | "evaluation"
  | "developer_tooling"
  | "enterprise_platforms"
  | "data_infrastructure"
  | "open_source"
  | "hardware"
  | "consumer_products"
  | "creative_tools"
  | "search_retrieval"
  | "robotics"
  | "healthcare"
  | "finance"
  | "research"
  | "governance_policy";

export type EventType =
  | "launch"
  | "funding"
  | "release"
  | "acquisition"
  | "paper"
  | "update"
  | "shutdown";

export interface NodeEvent {
  timestamp: string;
  event_type: EventType;
  summary: string;
  source_url: string;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  vertical: Vertical;
  verticals_secondary: Vertical[];
  status: NodeStatus;
  discovered_at: string;
  updated_at: string;
  events: NodeEvent[];
  significance: number;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface FeedItem {
  id: string;
  title: string;
  url: string;
  source: string;
  published_at: string;
  excerpt: string | null;
  vertical: Vertical | null;
  event_type: EventType | null;
  significance: number | null;
}

export interface RawItem {
  source: string;
  source_url: string;
  title: string;
  content: string;
  published_at: string;
  raw_metadata: Record<string, unknown>;
  skip_triage?: boolean;
}
