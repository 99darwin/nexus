import type { FastifyInstance } from "fastify";
import { getSession } from "../db/neo4j.js";
import { querySearch } from "../db/queries.js";

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { q: string; limit?: string };
  }>("/api/search", async (request, reply) => {
    const { q, limit } = request.query;
    if (!q || q.trim().length === 0) {
      reply.code(400).send({ error: "Query parameter 'q' is required" });
      return;
    }

    const session = getSession();
    try {
      const results = await querySearch(session, q.trim(), limit ? parseInt(limit, 10) : 20);
      return { results };
    } finally {
      await session.close();
    }
  });
}
