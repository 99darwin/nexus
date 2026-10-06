/**
 * SQL against `mcp_calls` (migration 004) — agent usage of the /mcp endpoint.
 */

import type pg from "pg";

export interface McpCall {
  method: string;
  tool?: string;
  clientName?: string;
  clientVersion?: string;
}

export async function insertMcpCall(pool: pg.Pool, call: McpCall): Promise<void> {
  await pool.query(
    `INSERT INTO mcp_calls (method, tool, client_name, client_version)
     VALUES ($1, $2, $3, $4)`,
    [call.method, call.tool ?? null, call.clientName ?? null, call.clientVersion ?? null],
  );
}

export interface McpUsage {
  /** Every recorded request in the window, all methods. */
  totalCalls: number;
  /** tools/call count per tool name. */
  byTool: Record<string, number>;
  /** initialize count per self-reported client name — i.e. agent sessions started. */
  byClient: Record<string, number>;
}

export async function queryMcpUsage(pool: pg.Pool, windowDays: number): Promise<McpUsage> {
  const window = `created_at >= NOW() - ($1::int * INTERVAL '1 day')`;

  const [totalResult, toolResult, clientResult] = await Promise.all([
    pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM mcp_calls WHERE ${window}`, [
      windowDays,
    ]),
    pool.query<{ tool: string; count: string }>(
      `SELECT tool, COUNT(*) AS count FROM mcp_calls
       WHERE ${window} AND method = 'tools/call' AND tool IS NOT NULL
       GROUP BY tool`,
      [windowDays],
    ),
    pool.query<{ client_name: string; count: string }>(
      `SELECT coalesce(client_name, 'unknown') AS client_name, COUNT(*) AS count FROM mcp_calls
       WHERE ${window} AND method = 'initialize'
       GROUP BY 1`,
      [windowDays],
    ),
  ]);

  const byTool: Record<string, number> = {};
  for (const row of toolResult.rows) byTool[row.tool] = parseInt(row.count, 10);

  const byClient: Record<string, number> = {};
  for (const row of clientResult.rows) byClient[row.client_name] = parseInt(row.count, 10);

  return {
    totalCalls: parseInt(totalResult.rows[0]?.count ?? "0", 10),
    byTool,
    byClient,
  };
}
