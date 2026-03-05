/**
 * Admin dashboard endpoint.
 *
 * Provides a data freshness and system health overview including
 * last mutation timestamp, processing counts, queue depth, and
 * graph statistics. Requires API key authentication.
 */

import type { FastifyInstance } from "fastify";
import { getSession } from "../../db/neo4j.js";
import { getPool } from "../../db/postgres.js";
import { requireApiKey } from "../../middleware/auth.js";

export interface DashboardResponse {
  lastMutationAt: string | null;
  itemsProcessed24h: number;
  queueDepth: number;
  nodeCount: number;
  edgeCount: number;
  adapterStats: Record<string, {
    successRate: number;
    totalItems: number;
    avgDurationMs: number;
  }>;
}

async function getLastMutationAt(neo4jSession: ReturnType<typeof getSession>): Promise<string | null> {
  const result = await neo4jSession.run(
    `MATCH (n:Entity)
     WHERE n.updated_at IS NOT NULL
     RETURN n.updated_at AS updated_at
     ORDER BY n.updated_at DESC
     LIMIT 1`,
  );

  if (result.records.length === 0) return null;

  const value = result.records[0].get("updated_at");
  if (!value) return null;

  // Neo4j may return a DateTime object or a string/number depending on how it was stored
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value.toStandardDate === "function") return value.toStandardDate().toISOString();

  return String(value);
}

async function getGraphCounts(neo4jSession: ReturnType<typeof getSession>): Promise<{
  nodeCount: number;
  edgeCount: number;
}> {
  const [nodeResult, edgeResult] = await Promise.all([
    neo4jSession.run("MATCH (n:Entity) RETURN count(n) AS count"),
    neo4jSession.run("MATCH ()-[r:RELATES_TO]->() RETURN count(r) AS count"),
  ]);

  const nodeCount = nodeResult.records[0]?.get("count")?.toNumber?.() ?? 0;
  const edgeCount = edgeResult.records[0]?.get("count")?.toNumber?.() ?? 0;

  return { nodeCount, edgeCount };
}

async function getItemsProcessed24h(pgPool: ReturnType<typeof getPool>): Promise<number> {
  const result = await pgPool.query(
    `SELECT COUNT(*) AS count
     FROM audit_log
     WHERE created_at >= NOW() - INTERVAL '24 hours'`,
  );

  return parseInt(result.rows[0]?.count ?? "0", 10);
}

async function getQueueDepth(pgPool: ReturnType<typeof getPool>): Promise<number> {
  const result = await pgPool.query(
    `SELECT COUNT(*) AS count
     FROM moderation_queue
     WHERE status = 'pending' OR status IS NULL`,
  );

  return parseInt(result.rows[0]?.count ?? "0", 10);
}

async function getAdapterStatsFromDb(pgPool: ReturnType<typeof getPool>): Promise<
  Record<string, { successRate: number; totalItems: number; avgDurationMs: number }>
> {
  const result = await pgPool.query(
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

  const stats: Record<string, { successRate: number; totalItems: number; avgDurationMs: number }> = {};

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
  app.get<{ Reply: DashboardResponse }>(
    "/api/admin/dashboard",
    { onRequest: requireApiKey },
    async () => {
      const neo4jSession = getSession();
      const pgPool = getPool();

      try {
        const [lastMutationAt, graphCounts, itemsProcessed24h, queueDepth, adapterStats] =
          await Promise.all([
            getLastMutationAt(neo4jSession),
            getGraphCounts(neo4jSession),
            getItemsProcessed24h(pgPool),
            getQueueDepth(pgPool),
            getAdapterStatsFromDb(pgPool),
          ]);

        return {
          lastMutationAt,
          itemsProcessed24h,
          queueDepth,
          nodeCount: graphCounts.nodeCount,
          edgeCount: graphCounts.edgeCount,
          adapterStats,
        };
      } finally {
        await neo4jSession.close();
      }
    },
  );
}
