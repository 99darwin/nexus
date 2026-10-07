/**
 * SQL against `client_bans` (migration 005) and the `mcp_calls` retention sweep.
 */

import type pg from "pg";

export interface ClientBan {
  clientKey: string;
  /** Epoch ms; null is permanent. */
  bannedUntil: number | null;
}

export async function queryActiveBans(pool: pg.Pool): Promise<ClientBan[]> {
  const result = await pool.query<{ client_key: string; banned_until: Date | null }>(
    `SELECT client_key, banned_until FROM client_bans
     WHERE banned_until IS NULL OR banned_until > NOW()`,
  );
  return result.rows.map((row) => ({
    clientKey: row.client_key,
    bannedUntil: row.banned_until ? row.banned_until.getTime() : null,
  }));
}

/** Never shortens an existing ban, and never turns a permanent one temporary. */
export async function upsertBan(
  pool: pg.Pool,
  ban: { clientKey: string; durationMs: number; reason: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO client_bans (client_key, reason, banned_until)
     VALUES ($1, $2, NOW() + ($3::bigint * INTERVAL '1 millisecond'))
     ON CONFLICT (client_key) DO UPDATE SET
       reason = EXCLUDED.reason,
       banned_until = CASE
         WHEN client_bans.banned_until IS NULL THEN NULL
         ELSE GREATEST(client_bans.banned_until, EXCLUDED.banned_until)
       END`,
    [ban.clientKey, ban.reason, ban.durationMs],
  );
}

/** Drops usage rows and lapsed bans older than `retentionDays`. */
export async function pruneExpired(pool: pg.Pool, retentionDays: number): Promise<void> {
  const cutoff = `NOW() - ($1::int * INTERVAL '1 day')`;
  await pool.query(`DELETE FROM mcp_calls WHERE created_at < ${cutoff}`, [retentionDays]);
  await pool.query(`DELETE FROM client_bans WHERE banned_until < ${cutoff}`, [retentionDays]);
}
