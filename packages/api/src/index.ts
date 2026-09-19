import { buildApp } from "./app.js";
import { closePool } from "./db/postgres.js";

const server = await buildApp();

const shutdown = async (): Promise<void> => {
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
