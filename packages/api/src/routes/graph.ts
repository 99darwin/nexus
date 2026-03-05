import type { FastifyInstance } from "fastify";
import { getSession } from "../db/neo4j.js";
import { queryFullGraph } from "../db/queries.js";

export async function graphRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { since?: string; cursor?: string; limit?: string };
  }>("/api/graph", async (request) => {
    const { since, cursor, limit } = request.query;
    const session = getSession();
    try {
      return await queryFullGraph(session, {
        since,
        cursor,
        limit: limit ? parseInt(limit, 10) : 100,
      });
    } finally {
      await session.close();
    }
  });
}
