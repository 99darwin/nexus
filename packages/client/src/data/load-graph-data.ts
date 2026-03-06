import type { GraphData, ForceNode, ForceLink } from "../graph/types";
import { fetchGraph } from "./api-client";

const PAGE_SIZE = 500;
const MAX_PAGES = 4;

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

  // Paginate to load nodes (capped at MAX_PAGES to avoid loading thousands)
  const allNodes: ForceNode[] = [];
  const edgeMap = new Map<string, Record<string, unknown>>();
  let cursor: string | null = null;
  let page = 0;

  do {
    const data = await fetchGraph({
      limit: PAGE_SIZE,
      significance_min: "0.4",
      ...(cursor ? { cursor } : {}),
    });

    allNodes.push(...(data.nodes as Array<Record<string, unknown>>).map(parseNode));

    // Accumulate edges across pages (each page returns edges scoped to its nodes)
    for (const e of data.edges as Array<Record<string, unknown>>) {
      const key = `${e.source_id}|${e.target_id}|${e.relationship}`;
      if (!edgeMap.has(key)) edgeMap.set(key, e);
    }

    cursor = data.cursor;
    page++;
  } while (cursor && page < MAX_PAGES);

  const nodeIds = new Set(allNodes.map((n) => n.id));
  const links: ForceLink[] = [...edgeMap.values()]
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
