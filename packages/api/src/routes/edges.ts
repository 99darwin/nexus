import type { FastifyInstance } from "fastify";
import neo4j from "neo4j-driver";
import { getSession } from "../db/neo4j.js";

export async function edgeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: {
      relationship?: string;
      source_vertical?: string;
      target_vertical?: string;
      since?: string;
      limit?: string;
    };
  }>("/api/edges", async (request) => {
    const q = request.query;
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (q.relationship) {
      conditions.push("r.relationship = $relationship");
      params.relationship = q.relationship;
    }
    if (q.source_vertical) {
      conditions.push("a.vertical = $source_vertical");
      params.source_vertical = q.source_vertical;
    }
    if (q.target_vertical) {
      conditions.push("b.vertical = $target_vertical");
      params.target_vertical = q.target_vertical;
    }
    if (q.since) {
      conditions.push("r.discovered_at >= $since");
      params.since = q.since;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(q.limit ? parseInt(q.limit, 10) || 100 : 100, 500));
    params.limit = neo4j.int(limit);

    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (a:Entity)-[r:RELATES_TO]->(b:Entity)
         ${where}
         RETURN a.id as source_id, b.id as target_id,
                r.relationship as relationship, r.discovered_at as discovered_at,
                r.confidence as confidence, r.evidence as evidence
         LIMIT $limit`,
        params,
      );

      const edges = result.records.map((rec) => ({
        source_id: rec.get("source_id"),
        target_id: rec.get("target_id"),
        relationship: rec.get("relationship"),
        discovered_at: rec.get("discovered_at"),
        confidence: rec.get("confidence"),
        evidence: rec.get("evidence"),
      }));

      return { edges };
    } finally {
      await session.close();
    }
  });
}
