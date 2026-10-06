/**
 * Background upkeep for the API process: keeps the denylist mirror fresh and
 * enforces retention. Started from index.ts rather than buildApp so tests,
 * which drive the app against a mocked pool, never see these queries.
 */

import type pg from "pg";
import type { FastifyBaseLogger } from "fastify";
import { pruneExpired } from "./db/client-bans.js";
import { reloadDenylist } from "./denylist.js";

/** How stale a hand-added ban can be before this instance enforces it. */
const DENYLIST_RELOAD_MS = 60 * 1000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** mcp_calls rows and lapsed bans older than this are deleted. */
const RETENTION_DAYS = 90;

/** Runs both jobs once now, then on their intervals. Returns a stop function. */
export function startMaintenance(pool: pg.Pool, log: FastifyBaseLogger): () => void {
  const reload = () =>
    reloadDenylist(pool).catch((error: unknown) => {
      log.error({ err: error }, "denylist reload failed; keeping the previous list");
    });
  const prune = () =>
    pruneExpired(pool, RETENTION_DAYS).catch((error: unknown) => {
      log.error({ err: error }, "retention prune failed");
    });

  void reload();
  void prune();
  const timers = [setInterval(reload, DENYLIST_RELOAD_MS), setInterval(prune, PRUNE_INTERVAL_MS)];
  for (const timer of timers) timer.unref();
  return () => timers.forEach(clearInterval);
}
