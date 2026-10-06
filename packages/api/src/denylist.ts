/**
 * Clients refused before any route or query runs.
 *
 * The source of truth is the `client_bans` table (migration 005), so bans
 * survive restarts and an operator can add one by hand. Checking it per
 * request would put a query in front of every request — including the ones
 * we are trying to shed — so it is mirrored into memory and reloaded on an
 * interval. Bans the API issues itself take effect locally at once and are
 * written through.
 */

import type pg from "pg";
import type { FastifyBaseLogger, onRequestAsyncHookHandler } from "fastify";
import { queryActiveBans, upsertBan } from "./db/client-bans.js";
import { isHealthCheck } from "./edge-proxy.js";

/** client key → ban expiry in epoch ms; Infinity for permanent. */
const bans = new Map<string, number>();

export function isDenied(clientKey: string): boolean {
  const until = bans.get(clientKey);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  bans.delete(clientKey);
  return false;
}

/** Replaces the in-memory mirror with the table's active bans. */
export async function reloadDenylist(pool: pg.Pool): Promise<void> {
  const active = await queryActiveBans(pool);
  bans.clear();
  for (const ban of active) bans.set(ban.clientKey, ban.bannedUntil ?? Infinity);
}

/** Enforces immediately, persists in the background. */
export function denyClient(
  pool: pg.Pool,
  log: FastifyBaseLogger,
  ban: { clientKey: string; durationMs: number; reason: string },
): void {
  const until = Date.now() + ban.durationMs;
  bans.set(ban.clientKey, Math.max(bans.get(ban.clientKey) ?? 0, until));
  log.warn(
    { clientKey: ban.clientKey, durationMs: ban.durationMs, reason: ban.reason },
    "client banned",
  );
  upsertBan(pool, ban).catch((error: unknown) => {
    log.error({ err: error }, "client_bans upsert failed; ban is local to this instance");
  });
}

/** Test-only: drop all bans. */
export function resetDenylist(): void {
  bans.clear();
}

/** Must run after edgeProxyHook, which resolves request.clientKey. */
export const denylistHook: onRequestAsyncHookHandler = async (request, reply) => {
  if (isHealthCheck(request)) return;
  if (isDenied(request.clientKey)) return reply.code(403).send({ error: "forbidden" });
};
