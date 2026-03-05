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

export type RelationshipType =
  | "built_on"
  | "competes_with"
  | "forked_from"
  | "integrates_with"
  | "acquired_by"
  | "funded_by"
  | "authored_by"
  | "benchmarked_on"
  | "succeeded_by"
  | "part_of"
  | "inspired_by"
  | "partners_with";

export interface GraphEdge {
  source_id: string;
  target_id: string;
  relationship: RelationshipType;
  discovered_at: string;
  confidence: number;
  evidence: string;
}

export type MutationOp =
  | { op: "upsert_node"; node: GraphNode }
  | { op: "upsert_edge"; edge: GraphEdge }
  | { op: "update_status"; id: string; status: NodeStatus; event: NodeEvent }
  | { op: "update_significance"; id: string; significance: number };

export interface AgentOutput {
  mutations: MutationOp[];
  analysis: string;
}
