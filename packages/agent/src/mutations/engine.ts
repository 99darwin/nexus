import type neo4j from "neo4j-driver";
import type { Pool } from "pg";
import type { MutationOp, GraphNode, GraphEdge, NodeEvent, NodeStatus } from "@nexus/shared";
import { detectConflicts } from "./conflict.js";
import { logMutation } from "./audit.js";
import { routeToModeration } from "./moderation.js";

function safeParseEvents(raw: unknown): NodeEvent[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dedupeEvents(events: NodeEvent[]): NodeEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (seen.has(e.source_url)) return false;
    seen.add(e.source_url);
    return true;
  });
}

export interface MutationEngineConfig {
  neo4jSession: neo4j.Session;
  pgPool?: Pool; // optional for audit logging
  moderationThreshold?: number; // default 0.5
}

export interface MutationResult {
  applied: number;
  rejected: number;
  moderated: number;
  errors: Array<{ op: MutationOp; error: string }>;
}

export async function applyMutations(
  mutations: MutationOp[],
  config: MutationEngineConfig,
): Promise<MutationResult> {
  const { neo4jSession, pgPool, moderationThreshold = 0.5 } = config;
  const result: MutationResult = { applied: 0, rejected: 0, moderated: 0, errors: [] };

  // Check for conflicts
  const { clean, conflicts } = detectConflicts(mutations);
  result.rejected += conflicts.length;
  for (const c of conflicts) {
    result.errors.push({ op: c, error: "Contradictory mutation rejected" });
  }

  for (const op of clean) {
    try {
      // Route low-confidence to moderation
      if (shouldModerate(op, moderationThreshold)) {
        if (pgPool) await routeToModeration(op, getConfidence(op), pgPool);
        result.moderated++;
        continue;
      }

      // Get before state for audit
      const beforeState = pgPool ? await getBeforeState(op, neo4jSession) : null;

      // Apply mutation
      await applyMutation(op, neo4jSession);

      // Get after state for audit
      const afterState = pgPool ? await getAfterState(op, neo4jSession) : null;

      // Log audit
      if (pgPool) await logMutation(op, beforeState, afterState, pgPool);

      result.applied++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ op, error: message });
      result.rejected++;
    }
  }

  return result;
}

function shouldModerate(op: MutationOp, threshold: number): boolean {
  if (op.op === "upsert_edge") return op.edge.confidence < threshold;
  return false;
}

function getConfidence(op: MutationOp): number {
  if (op.op === "upsert_edge") return op.edge.confidence;
  if (op.op === "upsert_node") return op.node.significance;
  return 1;
}

async function getBeforeState(
  op: MutationOp,
  session: neo4j.Session,
): Promise<Record<string, unknown> | null> {
  const id = getEntityId(op);
  if (!id) return null;
  const result = await session.run("MATCH (n:Entity {id: $id}) RETURN properties(n) as props", {
    id,
  });
  return result.records.length > 0 ? result.records[0].get("props") : null;
}

async function getAfterState(
  op: MutationOp,
  session: neo4j.Session,
): Promise<Record<string, unknown> | null> {
  const id = getEntityId(op);
  if (!id) return null;
  const result = await session.run("MATCH (n:Entity {id: $id}) RETURN properties(n) as props", {
    id,
  });
  return result.records.length > 0 ? result.records[0].get("props") : null;
}

function getEntityId(op: MutationOp): string | null {
  switch (op.op) {
    case "upsert_node":
      return op.node.id;
    case "upsert_edge":
      return op.edge.source_id;
    case "update_status":
      return op.id;
    case "update_significance":
      return op.id;
  }
}

async function applyMutation(op: MutationOp, session: neo4j.Session): Promise<void> {
  switch (op.op) {
    case "upsert_node":
      await upsertNode(op.node, session);
      break;
    case "upsert_edge":
      await upsertEdge(op.edge, session);
      break;
    case "update_status":
      await updateStatus(op.id, op.status, op.event, session);
      break;
    case "update_significance":
      await updateSignificance(op.id, op.significance, session);
      break;
  }
}

async function upsertNode(node: GraphNode, session: neo4j.Session): Promise<void> {
  // Read existing events to merge in TypeScript (avoids broken Cypher string concat)
  const existing = await session.run("MATCH (n:Entity {id: $id}) RETURN n.events as events", {
    id: node.id,
  });

  let mergedEvents = node.events;
  if (existing.records.length > 0) {
    const raw = existing.records[0].get("events");
    const existingEvents = safeParseEvents(raw);
    mergedEvents = dedupeEvents([...existingEvents, ...node.events]);
  }

  await session.run(
    `MERGE (n:Entity {id: $id})
     ON CREATE SET
       n.type = $type,
       n.name = $name,
       n.vertical = $vertical,
       n.verticals_secondary = $verticals_secondary,
       n.status = $status,
       n.discovered_at = $discovered_at,
       n.updated_at = $updated_at,
       n.significance = $significance,
       n.summary = $summary,
       n.events = $events,
       n.metadata = $metadata
     ON MATCH SET
       n.name = $name,
       n.vertical = $vertical,
       n.verticals_secondary = $verticals_secondary,
       n.status = $status,
       n.updated_at = $updated_at,
       n.significance = $significance,
       n.summary = $summary,
       n.events = $events,
       n.metadata = $metadata`,
    {
      id: node.id,
      type: node.type,
      name: node.name,
      vertical: node.vertical,
      verticals_secondary: node.verticals_secondary,
      status: node.status,
      discovered_at: node.discovered_at,
      updated_at: node.updated_at,
      significance: node.significance,
      summary: node.summary,
      events: JSON.stringify(mergedEvents),
      metadata: JSON.stringify(node.metadata),
    },
  );
}

async function upsertEdge(edge: GraphEdge, session: neo4j.Session): Promise<void> {
  await session.run(
    `MATCH (a:Entity {id: $source_id}), (b:Entity {id: $target_id})
     MERGE (a)-[r:RELATES_TO {relationship: $relationship}]->(b)
     ON CREATE SET
       r.discovered_at = $discovered_at,
       r.confidence = $confidence,
       r.evidence = $evidence
     ON MATCH SET
       r.confidence = $confidence,
       r.evidence = $evidence`,
    {
      source_id: edge.source_id,
      target_id: edge.target_id,
      relationship: edge.relationship,
      discovered_at: edge.discovered_at,
      confidence: edge.confidence,
      evidence: edge.evidence,
    },
  );
}

async function updateStatus(
  id: string,
  status: NodeStatus,
  event: NodeEvent,
  session: neo4j.Session,
): Promise<void> {
  // Read existing events to merge in TypeScript (avoids broken Cypher string concat)
  const existing = await session.run("MATCH (n:Entity {id: $id}) RETURN n.events as events", {
    id,
  });

  const existingEvents =
    existing.records.length > 0 ? safeParseEvents(existing.records[0].get("events")) : [];
  const mergedEvents = dedupeEvents([...existingEvents, event]);

  await session.run(
    `MATCH (n:Entity {id: $id})
     SET n.status = $status,
         n.updated_at = $timestamp,
         n.events = $events`,
    {
      id,
      status,
      timestamp: event.timestamp,
      events: JSON.stringify(mergedEvents),
    },
  );
}

async function updateSignificance(
  id: string,
  significance: number,
  session: neo4j.Session,
): Promise<void> {
  await session.run(
    `MATCH (n:Entity {id: $id})
     SET n.significance = $significance,
         n.updated_at = datetime().epochMillis`,
    { id, significance },
  );
}
