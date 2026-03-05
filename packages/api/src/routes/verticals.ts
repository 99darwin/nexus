import type { FastifyInstance } from "fastify";
import { getSession } from "../db/neo4j.js";
import { queryVerticals } from "../db/queries.js";

export async function verticalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/verticals", async () => {
    const session = getSession();
    try {
      return await queryVerticals(session);
    } finally {
      await session.close();
    }
  });
}
