import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { healthRoutes } from "./routes/health.js";
import { graphRoutes } from "./routes/graph.js";
import { nodeRoutes } from "./routes/nodes.js";
import { edgeRoutes } from "./routes/edges.js";
import { verticalRoutes } from "./routes/verticals.js";
import { timelineRoutes } from "./routes/timeline.js";
import { searchRoutes } from "./routes/search.js";
import { liveRoutes } from "./routes/live.js";
import { dashboardRoutes } from "./routes/admin/dashboard.js";
import { schemaRoutes } from "./routes/admin/schema.js";
import { closeDriver } from "./db/neo4j.js";
import { closePool } from "./db/postgres.js";

const server = Fastify({ logger: true });

// Plugins
const corsOrigin = process.env.CLIENT_ORIGIN ?? "*";
if (corsOrigin === "*" && process.env.NODE_ENV === "production") {
  server.log.warn("CLIENT_ORIGIN not set — CORS is open to all origins in production");
}
await server.register(cors, {
  origin: corsOrigin,
});

await server.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

await server.register(websocket);

// Routes
await server.register(healthRoutes);
await server.register(graphRoutes);
await server.register(nodeRoutes);
await server.register(edgeRoutes);
await server.register(verticalRoutes);
await server.register(timelineRoutes);
await server.register(searchRoutes);
await server.register(liveRoutes);
await server.register(dashboardRoutes);
await server.register(schemaRoutes);

// Graceful shutdown
const shutdown = async () => {
  await server.close();
  await closeDriver();
  await closePool();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start
const port = parseInt(process.env.PORT ?? process.env.API_PORT ?? "3001", 10);
const host = process.env.API_HOST ?? "0.0.0.0";

try {
  await server.listen({ port, host });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}

export { broadcastMutation } from "./routes/live.js";
