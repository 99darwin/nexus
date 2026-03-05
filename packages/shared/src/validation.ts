import { NODE_TYPES, NODE_STATUSES, RELATIONSHIP_TYPES, EVENT_TYPES } from "./constants.js";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

const VERTICALS = [
  "foundation_models", "inference", "training", "agents", "code_generation",
  "multimodal", "safety_alignment", "evaluation", "developer_tooling",
  "enterprise_platforms", "data_infrastructure", "open_source", "hardware",
  "consumer_products", "creative_tools", "search_retrieval", "robotics",
  "healthcare", "finance", "research", "governance_policy",
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidFloat01(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function isISOTimestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

export function validateGraphNode(node: unknown): ValidationResult {
  const errors: string[] = [];
  if (!node || typeof node !== "object") return { isValid: false, errors: ["Node must be an object"] };
  const n = node as Record<string, unknown>;

  if (!isNonEmptyString(n.id)) errors.push("id must be a non-empty string");
  if (!isNonEmptyString(n.name)) errors.push("name must be a non-empty string");
  if (!isNonEmptyString(n.summary)) errors.push("summary must be a non-empty string");
  if (!NODE_TYPES.includes(n.type as never)) errors.push(`type must be one of: ${NODE_TYPES.join(", ")}`);
  if (!VERTICALS.includes(n.vertical as never)) errors.push(`vertical must be one of: ${VERTICALS.join(", ")}`);
  if (!NODE_STATUSES.includes(n.status as never)) errors.push(`status must be one of: ${NODE_STATUSES.join(", ")}`);
  if (!isValidFloat01(n.significance)) errors.push("significance must be a number between 0 and 1");
  if (!isISOTimestamp(n.discovered_at)) errors.push("discovered_at must be a valid ISO timestamp");
  if (!isISOTimestamp(n.updated_at)) errors.push("updated_at must be a valid ISO timestamp");

  if (!Array.isArray(n.verticals_secondary)) {
    errors.push("verticals_secondary must be an array");
  } else {
    for (const v of n.verticals_secondary) {
      if (!VERTICALS.includes(v as never)) errors.push(`invalid secondary vertical: ${v}`);
    }
  }

  if (!Array.isArray(n.events)) {
    errors.push("events must be an array");
  } else {
    for (let i = 0; i < n.events.length; i++) {
      const e = n.events[i] as Record<string, unknown>;
      if (!isISOTimestamp(e.timestamp)) errors.push(`events[${i}].timestamp must be valid ISO`);
      if (!EVENT_TYPES.includes(e.event_type as never)) errors.push(`events[${i}].event_type invalid`);
      if (!isNonEmptyString(e.summary)) errors.push(`events[${i}].summary must be non-empty string`);
      if (!isNonEmptyString(e.source_url)) errors.push(`events[${i}].source_url must be non-empty string`);
    }
  }

  return { isValid: errors.length === 0, errors };
}

export function validateGraphEdge(edge: unknown): ValidationResult {
  const errors: string[] = [];
  if (!edge || typeof edge !== "object") return { isValid: false, errors: ["Edge must be an object"] };
  const e = edge as Record<string, unknown>;

  if (!isNonEmptyString(e.source_id)) errors.push("source_id must be a non-empty string");
  if (!isNonEmptyString(e.target_id)) errors.push("target_id must be a non-empty string");
  if (!RELATIONSHIP_TYPES.includes(e.relationship as never)) {
    errors.push(`relationship must be one of: ${RELATIONSHIP_TYPES.join(", ")}`);
  }
  if (!isISOTimestamp(e.discovered_at)) errors.push("discovered_at must be a valid ISO timestamp");
  if (!isValidFloat01(e.confidence)) errors.push("confidence must be a number between 0 and 1");
  if (!isNonEmptyString(e.evidence)) errors.push("evidence must be a non-empty string");

  return { isValid: errors.length === 0, errors };
}

export function validateMutationOp(op: unknown): ValidationResult {
  const errors: string[] = [];
  if (!op || typeof op !== "object") return { isValid: false, errors: ["MutationOp must be an object"] };
  const o = op as Record<string, unknown>;

  switch (o.op) {
    case "upsert_node":
      return validateGraphNode(o.node);
    case "upsert_edge":
      return validateGraphEdge(o.edge);
    case "update_status": {
      if (!isNonEmptyString(o.id)) errors.push("id must be a non-empty string");
      if (!NODE_STATUSES.includes(o.status as never)) errors.push("invalid status");
      if (!o.event || typeof o.event !== "object") {
        errors.push("event must be an object");
      } else {
        const ev = o.event as Record<string, unknown>;
        if (!isISOTimestamp(ev.timestamp)) errors.push("event.timestamp must be valid ISO");
        if (!EVENT_TYPES.includes(ev.event_type as never)) errors.push("event.event_type invalid");
      }
      break;
    }
    case "update_significance": {
      if (!isNonEmptyString(o.id)) errors.push("id must be a non-empty string");
      if (!isValidFloat01(o.significance)) errors.push("significance must be 0-1");
      break;
    }
    default:
      errors.push(`unknown op: ${o.op}`);
  }

  return { isValid: errors.length === 0, errors };
}

export function validateAgentOutput(output: unknown): ValidationResult {
  const errors: string[] = [];
  if (!output || typeof output !== "object") {
    return { isValid: false, errors: ["AgentOutput must be an object"] };
  }
  const o = output as Record<string, unknown>;

  if (!isNonEmptyString(o.analysis)) errors.push("analysis must be a non-empty string");

  if (!Array.isArray(o.mutations)) {
    errors.push("mutations must be an array");
  } else {
    for (let i = 0; i < o.mutations.length; i++) {
      const result = validateMutationOp(o.mutations[i]);
      if (!result.isValid) {
        errors.push(...result.errors.map((e) => `mutations[${i}]: ${e}`));
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}
