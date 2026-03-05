import type { GraphData, ForceNode, ForceLink } from "../graph/types";

interface SeedNode {
  id: string;
  type: string;
  name: string;
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
}

interface SeedEdge {
  source_id: string;
  target_id: string;
  relationship: string;
  confidence: number;
  evidence: string;
}

interface SeedData {
  nodes: SeedNode[];
  edges: SeedEdge[];
}

export async function loadSeedData(): Promise<GraphData> {
  const response = await fetch("/seed-data.json");
  const data: SeedData = await response.json();

  const nodes: ForceNode[] = data.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    vertical: n.vertical,
    significance: n.significance,
    status: n.status,
    summary: n.summary,
    updated_at: n.updated_at,
    discovered_at: n.discovered_at,
    events: n.events,
  }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links: ForceLink[] = data.edges
    .filter((e) => nodeIds.has(e.source_id) && nodeIds.has(e.target_id))
    .map((e) => ({
      source: e.source_id,
      target: e.target_id,
      relationship: e.relationship,
      confidence: e.confidence,
      evidence: e.evidence,
    }));

  return { nodes, links };
}
