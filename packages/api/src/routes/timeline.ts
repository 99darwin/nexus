import type { FastifyInstance } from "fastify";
import { getSession } from "../db/neo4j.js";

export async function timelineRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: {
      granularity?: "hour" | "day";
      from?: string;
      to?: string;
    };
  }>("/api/timeline", async (request) => {
    const { granularity = "day", from, to } = request.query;

    const session = getSession();
    try {
      const dateFormat = granularity === "hour" ? "%Y-%m-%dT%H:00:00Z" : "%Y-%m-%dT00:00:00Z";

      const conditions: string[] = [];
      const params: Record<string, unknown> = {};

      if (from) {
        conditions.push("n.updated_at >= $from");
        params.from = from;
      }
      if (to) {
        conditions.push("n.updated_at <= $to");
        params.to = to;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const result = await session.run(
        `MATCH (n:Entity) ${where}
         WITH n.vertical as vertical,
              substring(n.updated_at, 0, ${granularity === "hour" ? 13 : 10}) as period,
              count(n) as count
         RETURN vertical, period, count
         ORDER BY period DESC`,
        params,
      );

      const timeline = result.records.map((r) => ({
        vertical: r.get("vertical") as string,
        period: r.get("period") as string,
        count: (r.get("count") as { toNumber(): number }).toNumber(),
      }));

      return { timeline, granularity };
    } finally {
      await session.close();
    }
  });
}
