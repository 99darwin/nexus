import type { FastifyInstance } from "fastify";
import { checkNeo4jHealth } from "../db/neo4j.js";
import { checkPostgresHealth } from "../db/postgres.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => {
    const [neo4j, postgres] = await Promise.allSettled([checkNeo4jHealth(), checkPostgresHealth()]);

    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        neo4j: neo4j.status === "fulfilled" ? neo4j.value : false,
        postgres: postgres.status === "fulfilled" ? postgres.value : false,
      },
    };
  });
}
