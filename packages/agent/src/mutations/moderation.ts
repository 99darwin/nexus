import type { MutationOp } from "@nexus/shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = any;

export async function routeToModeration(
  op: MutationOp,
  confidence: number,
  pool: PgPool,
): Promise<void> {
  await pool.query(
    `INSERT INTO moderation_queue (mutation_op, confidence)
     VALUES ($1, $2)`,
    [JSON.stringify(op), confidence],
  );
}
