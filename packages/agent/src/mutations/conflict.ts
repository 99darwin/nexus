import type { MutationOp } from "@nexus/shared";

export interface ConflictResult {
  clean: MutationOp[];
  conflicts: MutationOp[];
}

export function detectConflicts(mutations: MutationOp[]): ConflictResult {
  const clean: MutationOp[] = [];
  const conflicts: MutationOp[] = [];

  // Group status updates by entity ID
  const statusUpdates = new Map<string, MutationOp[]>();

  for (const op of mutations) {
    if (op.op === "update_status") {
      const existing = statusUpdates.get(op.id) ?? [];
      existing.push(op);
      statusUpdates.set(op.id, existing);
    } else if (op.op === "upsert_node") {
      const existing = statusUpdates.get(op.node.id) ?? [];
      existing.push(op);
      statusUpdates.set(op.node.id, existing);
    }
  }

  // Check for contradictions
  const conflictIds = new Set<string>();
  for (const [id, ops] of statusUpdates) {
    if (ops.length < 2) continue;

    const statuses = new Set<string>();
    for (const op of ops) {
      if (op.op === "update_status") statuses.add(op.status);
      else if (op.op === "upsert_node") statuses.add(op.node.status);
    }

    if (statuses.size > 1) {
      conflictIds.add(id);
    }
  }

  for (const op of mutations) {
    const entityId = getEntityIdFromOp(op);
    if (entityId && conflictIds.has(entityId)) {
      conflicts.push(op);
    } else {
      clean.push(op);
    }
  }

  return { clean, conflicts };
}

function getEntityIdFromOp(op: MutationOp): string | null {
  switch (op.op) {
    case "upsert_node": return op.node.id;
    case "update_status": return op.id;
    case "update_significance": return op.id;
    case "upsert_edge": return null; // edges don't have status conflicts
  }
}
