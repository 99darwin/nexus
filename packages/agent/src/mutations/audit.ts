import type { MutationOp } from "@nexus/shared";

// Using any for pg.Pool to avoid import issues when pg isn't installed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = any;

export async function logMutation(
  op: MutationOp,
  beforeState: Record<string, unknown> | null,
  afterState: Record<string, unknown> | null,
  pool: PgPool,
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (mutation_op, before_state, after_state, source)
     VALUES ($1, $2, $3, $4)`,
    [
      JSON.stringify(op),
      beforeState ? JSON.stringify(beforeState) : null,
      afterState ? JSON.stringify(afterState) : null,
      "agent-pipeline",
    ],
  );
}
