import pg from "pg";

const { Pool } = pg;

/**
 * Deadlines, so a black-holed database fails instead of hanging.
 *
 * Without these a TCP connection to a host that silently drops packets sits
 * pending until the OS gives up (minutes), and every request behind it —
 * including the health probe — hangs with it. A readiness check that never
 * answers is worse than one that answers 503: orchestrators read "no response"
 * as "still starting" and keep routing traffic to a dead instance.
 */
const POOL_TIMEOUTS = {
  connectionTimeoutMillis: 5_000,
  /** Client-side cap; `statement_timeout` is the matching server-side one. */
  query_timeout: 10_000,
  statement_timeout: 10_000,
  idleTimeoutMillis: 30_000,
} as const;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    pool = connectionString
      ? new Pool({ connectionString, max: 10, ...POOL_TIMEOUTS })
      : new Pool({
          host: process.env.POSTGRES_HOST ?? "localhost",
          port: parseInt(process.env.POSTGRES_PORT ?? "5432", 10),
          database: process.env.POSTGRES_DB ?? "nexus",
          user: process.env.POSTGRES_USER ?? "nexus",
          password: process.env.POSTGRES_PASSWORD,
          max: 10,
          ...POOL_TIMEOUTS,
        });

    // pg emits 'error' on idle clients when the backend goes away (restart,
    // failover, network blip). Node turns an unhandled 'error' event into a
    // process exit, so without this listener a database hiccup takes down the
    // whole API. The pool discards the dead client on its own.
    pool.on("error", (error) => {
      console.error("[postgres] idle client error", error);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function checkPostgresHealth(): Promise<boolean> {
  try {
    const p = getPool();
    await p.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
