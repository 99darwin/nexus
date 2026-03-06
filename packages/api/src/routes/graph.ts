import type { FastifyInstance } from "fastify";
import { getSession } from "../db/neo4j.js";
import { queryFullGraph } from "../db/queries.js";

export async function graphRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { since?: string; cursor?: string; limit?: string; significance_min?: string };
  }>("/api/graph", async (request) => {
    const { since, cursor, limit, significance_min } = request.query;
    const parsedSigMin = significance_min ? parseFloat(significance_min) : undefined;
    const session = getSession();
    try {
      return await queryFullGraph(session, {
        since,
        offset: cursor ? parseInt(cursor, 10) || 0 : 0,
        limit: Math.max(1, Math.min(limit ? parseInt(limit, 10) || 100 : 100, 500)),
        significance_min:
          parsedSigMin !== undefined && Number.isFinite(parsedSigMin)
            ? Math.max(0, Math.min(parsedSigMin, 1))
            : undefined,
      });
    } finally {
      await session.close();
    }
  });
}
