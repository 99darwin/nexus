import type { GraphData, ForceNode, ForceLink } from "../graph/types";
import { fetchGraph } from "./api-client";

export async function loadGraphData(): Promise<GraphData> {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) throw new Error("No API URL configured");

  const data = await fetchGraph();

  const nodes: ForceNode[] = (data.nodes as Array<Record<string, unknown>>).map((n) => ({
    id: n.id as string,
    name: n.name as string,
    type: n.type as string,
    vertical: n.vertical as string,
    significance: n.significance as number,
    status: n.status as string,
    summary: n.summary as string,
    updated_at: n.updated_at as string,
    discovered_at: n.discovered_at as string,
    events: (n.events as Array<Record<string, string>> ?? []).map((e) => ({
      timestamp: e.timestamp,
      event_type: e.event_type,
      summary: e.summary,
      source_url: e.source_url,
    })),
  }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links: ForceLink[] = (data.edges as Array<Record<string, unknown>>)
    .filter((e) => nodeIds.has(e.source_id as string) && nodeIds.has(e.target_id as string))
    .map((e) => ({
      source: e.source_id as string,
      target: e.target_id as string,
      relationship: e.relationship as string,
      confidence: e.confidence as number,
      evidence: e.evidence as string,
    }));

  return { nodes, links };
}
