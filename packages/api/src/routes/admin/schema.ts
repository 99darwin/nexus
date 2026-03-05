import type { FastifyInstance } from "fastify";
import { getSession } from "../../db/neo4j.js";
import { requireApiKey } from "../../middleware/auth.js";

const SCHEMA_STATEMENTS = [
  `CREATE CONSTRAINT entity_id_unique IF NOT EXISTS
   FOR (n:Entity) REQUIRE n.id IS UNIQUE`,
  `CREATE INDEX entity_type IF NOT EXISTS FOR (n:Entity) ON (n.type)`,
  `CREATE INDEX entity_vertical IF NOT EXISTS FOR (n:Entity) ON (n.vertical)`,
  `CREATE INDEX entity_status IF NOT EXISTS FOR (n:Entity) ON (n.status)`,
  `CREATE INDEX entity_significance IF NOT EXISTS FOR (n:Entity) ON (n.significance)`,
  `CREATE INDEX entity_updated_at IF NOT EXISTS FOR (n:Entity) ON (n.updated_at)`,
  `CREATE FULLTEXT INDEX entity_search IF NOT EXISTS
   FOR (n:Entity) ON EACH [n.name, n.summary]`,
];

export async function schemaRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/admin/schema",
    { onRequest: requireApiKey },
    async () => {
      const session = getSession();
      const results: Array<{ statement: string; status: string }> = [];

      try {
        for (const statement of SCHEMA_STATEMENTS) {
          try {
            await session.run(statement);
            results.push({ statement: statement.split("\n")[0].trim(), status: "ok" });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            results.push({ statement: statement.split("\n")[0].trim(), status: message });
          }
        }

        return { applied: results.filter((r) => r.status === "ok").length, results };
      } finally {
        await session.close();
      }
    },
  );
}
