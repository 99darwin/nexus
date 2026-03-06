import type { FastifyInstance } from "fastify";
import { getSession } from "../db/neo4j.js";
import { queryNodes, queryNodeById, queryNeighborhood } from "../db/queries.js";

export async function nodeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: {
      vertical?: string;
      type?: string;
      status?: string;
      significance_min?: string;
      since?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/nodes", async (request) => {
    const q = request.query;
    const session = getSession();
    try {
      const limit = Math.max(1, Math.min(q.limit ? parseInt(q.limit, 10) || 100 : 100, 500));
      const offset = Math.max(0, q.offset ? parseInt(q.offset, 10) || 0 : 0);
      const significance_min = q.significance_min
        ? Math.max(0, Math.min(parseFloat(q.significance_min), 1))
        : undefined;
      const nodes = await queryNodes(session, {
        vertical: q.vertical,
        type: q.type,
        status: q.status,
        significance_min:
          significance_min !== undefined && Number.isFinite(significance_min)
            ? significance_min
            : undefined,
        since: q.since,
        search: q.search,
        limit,
        offset,
      });
      return { nodes };
    } finally {
      await session.close();
    }
  });

  app.get<{ Params: { id: string } }>("/api/nodes/:id", async (request, reply) => {
    const session = getSession();
    try {
      const { node, edges } = await queryNodeById(session, request.params.id);
      if (!node) {
        reply.code(404).send({ error: "Node not found" });
        return;
      }
      return { ...node, edges };
    } finally {
      await session.close();
    }
  });

  app.get<{
    Params: { id: string };
    Querystring: { depth?: string };
  }>("/api/nodes/:id/neighborhood", async (request) => {
    const session = getSession();
    try {
      const rawDepth = request.query.depth ? parseInt(request.query.depth, 10) : 1;
      const depth = Number.isFinite(rawDepth) ? Math.max(1, Math.min(rawDepth, 3)) : 1;
      return await queryNeighborhood(session, request.params.id, depth);
    } finally {
      await session.close();
    }
  });
}
