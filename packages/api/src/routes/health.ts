import type { FastifyInstance } from "fastify";
import { checkPostgresHealth } from "../db/postgres.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async (_request, reply) => {
    const postgres = await checkPostgresHealth();

    // Postgres is the only datastore — without it every route 500s. A 200
    // here would keep load balancers and container healthchecks sending
    // traffic to an instance that cannot serve any of it.
    if (!postgres) reply.code(503);

    return {
      status: postgres ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      services: { postgres },
    };
  });
}
