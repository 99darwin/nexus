export interface VerticalCentroid {
  vertical: string;
  x: number;
  y: number;
  z: number;
  stiffness: number;
}

export interface ForceNode {
  id: string;
  name: string;
  type: string;
  vertical: string;
  significance: number;
  status: string;
  summary: string;
  updated_at: string;
  discovered_at: string;
  events: Array<{
    timestamp: string;
    event_type: string;
    summary: string;
    source_url: string;
  }>;
  // cluster fields (set by cluster transform)
  isCluster?: boolean;
  clusterCount?: number;
  clusterNodeIds?: string[];
  // d3-force position fields
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

export interface ForceLink {
  source: string | ForceNode;
  target: string | ForceNode;
  relationship: string;
  confidence: number;
  evidence: string;
}

export interface GraphData {
  nodes: ForceNode[];
  links: ForceLink[];
}
