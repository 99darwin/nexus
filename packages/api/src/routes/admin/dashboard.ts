/**
 * Admin dashboard endpoint.
 *
 * Data-freshness and ingestion-health overview: newest indexed item, total
 * feed size, 24h processing count, review queue depth, and per-adapter run
 * stats. Requires API key authentication.
 *
 * The audit_log and moderation_queue tables are legacy from the graph
 * pipeline and are being retired, so their sub-queries degrade to 0 rather
 * than failing the whole response.
 */

import type { FastifyInstance } from "fastify";
import { getPool } from "../../db/postgres.js";
import { requireApiKey } from "../../middleware/auth.js";

export interface DashboardResponse {
  lastItemAt: string | null;
  feedItemCount: number;
  itemsProcessed24h: number;
  queueDepth: number;
  adapterStats: Record<
    string,
    {
      successRate: number;
      totalItems: number;
      avgDurationMs: number;
    }
  >;
}

type Pool = ReturnType<typeof getPool>;

async function getFeedFreshness(pool: Pool): Promise<{ lastItemAt: string | null; count: number }> {
  const result = await pool.query<{ last_item_at: Date | null; count: string }>(
    `SELECT MAX(published_at) AS last_item_at, COUNT(*) AS count FROM feed_items`,
  );

  const row = result.rows[0];
  const lastItemAt = row?.last_item_at ?? null;

  return {
    lastItemAt: lastItemAt instanceof Date ? lastItemAt.toISOString() : (lastItemAt ?? null),
    count: parseInt(row?.count ?? "0", 10),
  };
}

async function getItemsProcessed24h(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM audit_log
     WHERE created_at >= NOW() - INTERVAL '24 hours'`,
  );

  return parseInt(result.rows[0]?.count ?? "0", 10);
}

async function getQueueDepth(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM moderation_queue
     WHERE status = 'pending' OR status IS NULL`,
  );

  return parseInt(result.rows[0]?.count ?? "0", 10);
}

async function getAdapterStatsFromDb(
  pool: Pool,
): Promise<Record<string, { successRate: number; totalItems: number; avgDurationMs: number }>> {
  const result = await pool.query(
    `SELECT
       adapter_name,
       COUNT(*) FILTER (WHERE success = true) AS success_count,
       COUNT(*) AS total_runs,
       COALESCE(SUM(item_count) FILTER (WHERE success = true), 0) AS total_items,
       COALESCE(AVG(duration_ms), 0) AS avg_duration_ms
     FROM adapter_runs
     WHERE created_at >= NOW() - INTERVAL '7 days'
     GROUP BY adapter_name`,
  );

  const stats: Record<string, { successRate: number; totalItems: number; avgDurationMs: number }> =
    {};

  for (const row of result.rows) {
    const totalRuns = parseInt(row.total_runs, 10);
    const successCount = parseInt(row.success_count, 10);

    stats[row.adapter_name] = {
      successRate: totalRuns > 0 ? successCount / totalRuns : 0,
      totalItems: parseInt(row.total_items, 10),
      avgDurationMs: Math.round(parseFloat(row.avg_duration_ms)),
    };
  }

  return stats;
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // Authenticated operational data — never store it in a browser or an
  // intermediary cache.
  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "private, no-store");
  });

  app.get<{ Reply: DashboardResponse }>(
    "/api/admin/dashboard",
    { onRequest: requireApiKey },
    async (request) => {
      const pool = getPool();

      const [freshness, itemsProcessed24h, queueDepth, adapterStats] = await Promise.allSettled([
        getFeedFreshness(pool),
        getItemsProcessed24h(pool),
        getQueueDepth(pool),
        getAdapterStatsFromDb(pool),
      ]);

      for (const outcome of [freshness, itemsProcessed24h, queueDepth, adapterStats]) {
        if (outcome.status === "rejected") {
          request.log.error({ err: outcome.reason }, "dashboard sub-query failed");
        }
      }

      return {
        lastItemAt: freshness.status === "fulfilled" ? freshness.value.lastItemAt : null,
        feedItemCount: freshness.status === "fulfilled" ? freshness.value.count : 0,
        itemsProcessed24h: itemsProcessed24h.status === "fulfilled" ? itemsProcessed24h.value : 0,
        queueDepth: queueDepth.status === "fulfilled" ? queueDepth.value : 0,
        adapterStats: adapterStats.status === "fulfilled" ? adapterStats.value : {},
      };
    },
  );
}
