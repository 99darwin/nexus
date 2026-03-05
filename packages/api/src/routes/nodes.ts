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
      const nodes = await queryNodes(session, {
        vertical: q.vertical,
        type: q.type,
        status: q.status,
        significance_min: q.significance_min ? parseFloat(q.significance_min) : undefined,
        since: q.since,
        search: q.search,
        limit: q.limit ? parseInt(q.limit, 10) : 100,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
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
      const depth = request.query.depth ? parseInt(request.query.depth, 10) : 1;
      return await queryNeighborhood(session, request.params.id, depth);
    } finally {
      await session.close();
    }
  });
}
