import type { GraphData, ForceNode, ForceLink } from "../graph/types";
import { fetchGraph } from "./api-client";

const PAGE_SIZE = 500;

function parseNode(n: Record<string, unknown>): ForceNode {
  return {
    id: n.id as string,
    name: n.name as string,
    type: n.type as string,
    vertical: n.vertical as string,
    significance: n.significance as number,
    status: n.status as string,
    summary: n.summary as string,
    updated_at: n.updated_at as string,
    discovered_at: n.discovered_at as string,
    events: ((n.events as Array<Record<string, string>>) ?? []).map((e) => ({
      timestamp: e.timestamp,
      event_type: e.event_type,
      summary: e.summary,
      source_url: e.source_url,
    })),
  };
}

export async function loadGraphData(): Promise<GraphData> {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) throw new Error("No API URL configured");

  // Paginate to load all nodes (graph may exceed single-page limit)
  const allNodes: ForceNode[] = [];
  let allEdges: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let isFirstPage = true;

  do {
    const data = await fetchGraph({
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });

    allNodes.push(...(data.nodes as Array<Record<string, unknown>>).map(parseNode));

    // Edges are returned in full on every page; only take them once
    if (isFirstPage) {
      allEdges = data.edges as Array<Record<string, unknown>>;
      isFirstPage = false;
    }

    cursor = data.cursor;
  } while (cursor);

  const nodeIds = new Set(allNodes.map((n) => n.id));
  const links: ForceLink[] = allEdges
    .filter((e) => nodeIds.has(e.source_id as string) && nodeIds.has(e.target_id as string))
    .map((e) => ({
      source: e.source_id as string,
      target: e.target_id as string,
      relationship: e.relationship as string,
      confidence: e.confidence as number,
      evidence: e.evidence as string,
    }));

  return { nodes: allNodes, links };
}
