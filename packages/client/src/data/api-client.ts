const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

async function fetchJson<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, API_BASE);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

export async function fetchGraph(options?: {
  since?: string;
  cursor?: string;
  limit?: number;
  significance_min?: string;
}) {
  return fetchJson<{
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
    cursor: string | null;
  }>("/api/graph", {
    since: options?.since ?? "",
    cursor: options?.cursor ?? "",
    limit: options?.limit?.toString() ?? "",
    significance_min: options?.significance_min ?? "",
  });
}

export async function fetchNode(id: string) {
  return fetchJson<Record<string, unknown>>(`/api/nodes/${id}`);
}

export async function fetchNeighborhood(id: string, depth = 1) {
  return fetchJson<{
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  }>(`/api/nodes/${id}/neighborhood`, { depth: depth.toString() });
}

export async function fetchVerticals() {
  return fetchJson<
    Array<{
      vertical: string;
      node_count: number;
      avg_significance: number;
      top_entities: Array<{ id: string; name: string; significance: number }>;
    }>
  >("/api/verticals");
}

export async function fetchTimeline(from?: string, to?: string, granularity?: "hour" | "day") {
  return fetchJson<{
    timeline: Array<{ vertical: string; period: string; count: number }>;
    granularity: string;
  }>("/api/timeline", { from: from ?? "", to: to ?? "", granularity: granularity ?? "" });
}

export async function searchNodes(query: string) {
  return fetchJson<{ results: Record<string, unknown>[] }>("/api/search", { q: query });
}
