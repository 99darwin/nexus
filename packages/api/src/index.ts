import { buildApp } from "./app.js";
import { closePool, getPool } from "./db/postgres.js";
import { startMaintenance } from "./maintenance.js";

const server = await buildApp();
const stopMaintenance = startMaintenance(getPool(), server.log);

const shutdown = async (): Promise<void> => {
  stopMaintenance();
  await server.close();
  await closePool();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const port = parseInt(process.env.PORT ?? process.env.API_PORT ?? "3001", 10);
const host = process.env.API_HOST ?? "0.0.0.0";

try {
  await server.listen({ port, host });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
