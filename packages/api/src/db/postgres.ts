import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    pool = connectionString
      ? new Pool({ connectionString, max: 10 })
      : new Pool({
          host: process.env.POSTGRES_HOST ?? "localhost",
          port: parseInt(process.env.POSTGRES_PORT ?? "5432", 10),
          database: process.env.POSTGRES_DB ?? "nexus",
          user: process.env.POSTGRES_USER ?? "nexus",
          password: process.env.POSTGRES_PASSWORD,
          max: 10,
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
