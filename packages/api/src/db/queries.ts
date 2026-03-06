import neo4j, { type Session } from "neo4j-driver";

export interface NodeResult {
  id: string;
  type: string;
  name: string;
  vertical: string;
  verticals_secondary: string[];
  status: string;
  discovered_at: string;
  updated_at: string;
  significance: number;
  summary: string;
  events: Array<{ timestamp: string; event_type: string; summary: string; source_url: string }>;
  metadata: Record<string, unknown>;
}

export interface EdgeResult {
  source_id: string;
  target_id: string;
  relationship: string;
  discovered_at: string;
  confidence: number;
  evidence: string;
}

function parseNode(raw: Record<string, unknown>): NodeResult {
  return {
    ...raw,
    events: typeof raw.events === "string" ? JSON.parse(raw.events) : (raw.events ?? []),
    metadata: typeof raw.metadata === "string" ? JSON.parse(raw.metadata) : (raw.metadata ?? {}),
    verticals_secondary: raw.verticals_secondary ?? [],
  } as NodeResult;
}

export async function queryFullGraph(
  session: Session,
  options: { since?: string; cursor?: string; limit?: number },
): Promise<{ nodes: NodeResult[]; edges: EdgeResult[]; cursor: string | null }> {
  const limit = options.limit ?? 100;

  let nodeQuery = `MATCH (n:Entity)`;
  const params: Record<string, unknown> = { limit: neo4j.int(limit) };

  if (options.since) {
    nodeQuery += ` WHERE n.updated_at >= $since`;
    params.since = options.since;
  }
  if (options.cursor) {
    nodeQuery += options.since ? ` AND n.id > $cursor` : ` WHERE n.id > $cursor`;
    params.cursor = options.cursor;
  }
  nodeQuery += ` RETURN properties(n) as props ORDER BY n.id LIMIT $limit`;

  const nodeResult = await session.run(nodeQuery, params);
  const nodes = nodeResult.records.map((r) => parseNode(r.get("props")));

  const edgeResult = await session.run(
    `MATCH (a:Entity)-[r:RELATES_TO]->(b:Entity)
     RETURN a.id as source_id, b.id as target_id,
            r.relationship as relationship, r.discovered_at as discovered_at,
            r.confidence as confidence, r.evidence as evidence`,
  );
  const edges = edgeResult.records.map((r) => ({
    source_id: r.get("source_id") as string,
    target_id: r.get("target_id") as string,
    relationship: r.get("relationship") as string,
    discovered_at: r.get("discovered_at") as string,
    confidence: r.get("confidence") as number,
    evidence: r.get("evidence") as string,
  }));

  const nextCursor = nodes.length === limit ? nodes[nodes.length - 1].id : null;

  return { nodes, edges, cursor: nextCursor };
}

export async function queryNodes(
  session: Session,
  filters: {
    vertical?: string;
    type?: string;
    status?: string;
    significance_min?: number;
    since?: string;
    search?: string;
    limit?: number;
    offset?: number;
  },
): Promise<NodeResult[]> {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.vertical) {
    conditions.push("n.vertical = $vertical");
    params.vertical = filters.vertical;
  }
  if (filters.type) {
    conditions.push("n.type = $type");
    params.type = filters.type;
  }
  if (filters.status) {
    conditions.push("n.status = $status");
    params.status = filters.status;
  }
  if (filters.significance_min !== undefined) {
    conditions.push("n.significance >= $significance_min");
    params.significance_min = filters.significance_min;
  }
  if (filters.since) {
    conditions.push("n.updated_at >= $since");
    params.since = filters.since;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;
  params.limit = neo4j.int(limit);
  params.offset = neo4j.int(offset);

  const query = `MATCH (n:Entity) ${where}
    RETURN properties(n) as props
    ORDER BY n.significance DESC
    SKIP $offset LIMIT $limit`;

  const result = await session.run(query, params);
  return result.records.map((r) => parseNode(r.get("props")));
}

export async function queryNodeById(
  session: Session,
  id: string,
): Promise<{ node: NodeResult | null; edges: EdgeResult[] }> {
  const nodeResult = await session.run(
    "MATCH (n:Entity {id: $id}) RETURN properties(n) as props",
    { id },
  );

  if (nodeResult.records.length === 0) return { node: null, edges: [] };

  const node = parseNode(nodeResult.records[0].get("props"));

  const edgeResult = await session.run(
    `MATCH (a:Entity {id: $id})-[r:RELATES_TO]-(b:Entity)
     RETURN
       CASE WHEN startNode(r) = a THEN a.id ELSE b.id END as source_id,
       CASE WHEN startNode(r) = a THEN b.id ELSE a.id END as target_id,
       r.relationship as relationship, r.discovered_at as discovered_at,
       r.confidence as confidence, r.evidence as evidence`,
    { id },
  );

  const edges = edgeResult.records.map((r) => ({
    source_id: r.get("source_id") as string,
    target_id: r.get("target_id") as string,
    relationship: r.get("relationship") as string,
    discovered_at: r.get("discovered_at") as string,
    confidence: r.get("confidence") as number,
    evidence: r.get("evidence") as string,
  }));

  return { node, edges };
}

export async function queryNeighborhood(
  session: Session,
  id: string,
  depth: number = 1,
): Promise<{ nodes: NodeResult[]; edges: EdgeResult[] }> {
  const result = await session.run(
    `MATCH path = (start:Entity {id: $id})-[r:RELATES_TO*1..${Math.min(depth, 3)}]-(neighbor:Entity)
     WITH DISTINCT neighbor, r
     RETURN properties(neighbor) as props`,
    { id },
  );

  const neighborNodes = result.records.map((r) => parseNode(r.get("props")));

  // Also get the center node
  const centerResult = await session.run(
    "MATCH (n:Entity {id: $id}) RETURN properties(n) as props",
    { id },
  );
  const centerNode = centerResult.records[0] ? parseNode(centerResult.records[0].get("props")) : undefined;
  const nodes = centerNode ? [centerNode, ...neighborNodes] : neighborNodes;

  // Get edges between these nodes
  const nodeIds = nodes.map((n) => n.id);
  const edgeResult = await session.run(
    `MATCH (a:Entity)-[r:RELATES_TO]->(b:Entity)
     WHERE a.id IN $ids AND b.id IN $ids
     RETURN a.id as source_id, b.id as target_id,
            r.relationship as relationship, r.discovered_at as discovered_at,
            r.confidence as confidence, r.evidence as evidence`,
    { ids: nodeIds },
  );

  const edges = edgeResult.records.map((r) => ({
    source_id: r.get("source_id") as string,
    target_id: r.get("target_id") as string,
    relationship: r.get("relationship") as string,
    discovered_at: r.get("discovered_at") as string,
    confidence: r.get("confidence") as number,
    evidence: r.get("evidence") as string,
  }));

  return { nodes, edges };
}

export async function querySearch(
  session: Session,
  query: string,
  limit: number = 20,
): Promise<NodeResult[]> {
  const result = await session.run(
    `CALL db.index.fulltext.queryNodes("entity_search", $query)
     YIELD node, score
     RETURN properties(node) as props, score
     ORDER BY score DESC
     LIMIT $limit`,
    { query: `${query}~`, limit: neo4j.int(limit) },
  );

  return result.records.map((r) => parseNode(r.get("props")));
}

export async function queryVerticals(session: Session): Promise<
  Array<{
    vertical: string;
    node_count: number;
    avg_significance: number;
    top_entities: Array<{ id: string; name: string; significance: number }>;
  }>
> {
  const result = await session.run(
    `MATCH (n:Entity)
     WITH n.vertical as vertical,
          count(n) as node_count,
          avg(n.significance) as avg_significance,
          collect({id: n.id, name: n.name, significance: n.significance}) as entities
     RETURN vertical, node_count, avg_significance,
            [e IN entities | e][..5] as top_entities
     ORDER BY node_count DESC`,
  );

  return result.records.map((r) => ({
    vertical: r.get("vertical") as string,
    node_count: (r.get("node_count") as { toNumber(): number }).toNumber(),
    avg_significance: r.get("avg_significance") as number,
    top_entities: r.get("top_entities") as Array<{
      id: string;
      name: string;
      significance: number;
    }>,
  }));
}
