import { describe, it, expect } from "vitest";
import {
  validateGraphNode,
  validateGraphEdge,
  validateMutationOp,
  validateAgentOutput,
} from "../validation.js";
import type { GraphNode, GraphEdge } from "../types.js";

const validNode: GraphNode = {
  id: "anthropic/claude-4",
  type: "model",
  name: "Claude 4",
  vertical: "foundation_models",
  verticals_secondary: ["agents"],
  status: "ga",
  discovered_at: "2025-06-01T00:00:00Z",
  updated_at: "2025-06-01T00:00:00Z",
  events: [
    {
      timestamp: "2025-06-01T00:00:00Z",
      event_type: "launch",
      summary: "Claude 4 general availability",
      source_url: "https://anthropic.com/claude-4",
    },
  ],
  significance: 0.95,
  summary: "Anthropic's flagship frontier model.",
  metadata: { parameters: "unknown" },
};

const validEdge: GraphEdge = {
  source_id: "anthropic/claude-4",
  target_id: "anthropic",
  relationship: "authored_by",
  discovered_at: "2025-06-01T00:00:00Z",
  confidence: 0.99,
  evidence: "Anthropic built Claude 4. https://anthropic.com",
};

describe("validateGraphNode", () => {
  it("accepts a valid node", () => {
    const result = validateGraphNode(validNode);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects null input", () => {
    const result = validateGraphNode(null);
    expect(result.isValid).toBe(false);
  });

  it("rejects missing id", () => {
    const result = validateGraphNode({ ...validNode, id: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("id must be a non-empty string");
  });

  it("rejects invalid type", () => {
    const result = validateGraphNode({ ...validNode, type: "robot" });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/type must be one of/);
  });

  it("rejects invalid vertical", () => {
    const result = validateGraphNode({ ...validNode, vertical: "unknown" });
    expect(result.isValid).toBe(false);
  });

  it("rejects significance out of range", () => {
    const result = validateGraphNode({ ...validNode, significance: 1.5 });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("significance must be a number between 0 and 1");
  });

  it("rejects invalid secondary verticals", () => {
    const result = validateGraphNode({ ...validNode, verticals_secondary: ["fake_vertical"] });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/invalid secondary vertical/);
  });

  it("rejects invalid event", () => {
    const result = validateGraphNode({
      ...validNode,
      events: [{ timestamp: "not-a-date", event_type: "bad", summary: "", source_url: "" }],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateGraphEdge", () => {
  it("accepts a valid edge", () => {
    const result = validateGraphEdge(validEdge);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects null input", () => {
    const result = validateGraphEdge(null);
    expect(result.isValid).toBe(false);
  });

  it("rejects invalid relationship", () => {
    const result = validateGraphEdge({ ...validEdge, relationship: "hates" });
    expect(result.isValid).toBe(false);
  });

  it("rejects confidence out of range", () => {
    const result = validateGraphEdge({ ...validEdge, confidence: -0.1 });
    expect(result.isValid).toBe(false);
  });
});

describe("validateMutationOp", () => {
  it("validates upsert_node", () => {
    const result = validateMutationOp({ op: "upsert_node", node: validNode });
    expect(result.isValid).toBe(true);
  });

  it("validates upsert_edge", () => {
    const result = validateMutationOp({ op: "upsert_edge", edge: validEdge });
    expect(result.isValid).toBe(true);
  });

  it("validates update_status", () => {
    const result = validateMutationOp({
      op: "update_status",
      id: "anthropic/claude-4",
      status: "deprecated",
      event: {
        timestamp: "2026-01-01T00:00:00Z",
        event_type: "shutdown",
        summary: "Model deprecated",
        source_url: "https://example.com",
      },
    });
    expect(result.isValid).toBe(true);
  });

  it("validates update_significance", () => {
    const result = validateMutationOp({
      op: "update_significance",
      id: "anthropic/claude-4",
      significance: 0.8,
    });
    expect(result.isValid).toBe(true);
  });

  it("rejects unknown op", () => {
    const result = validateMutationOp({ op: "delete_node", id: "test" });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/unknown op/);
  });
});

describe("validateAgentOutput", () => {
  it("accepts valid output", () => {
    const result = validateAgentOutput({
      mutations: [
        { op: "upsert_node", node: validNode },
        { op: "upsert_edge", edge: validEdge },
      ],
      analysis: "Added Claude 4 and its authorship edge.",
    });
    expect(result.isValid).toBe(true);
  });

  it("rejects missing analysis", () => {
    const result = validateAgentOutput({ mutations: [], analysis: "" });
    expect(result.isValid).toBe(false);
  });

  it("rejects non-object", () => {
    const result = validateAgentOutput("not an object");
    expect(result.isValid).toBe(false);
  });

  it("reports nested mutation errors", () => {
    const result = validateAgentOutput({
      mutations: [{ op: "upsert_node", node: { id: "" } }],
      analysis: "test",
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("mutations[0]"))).toBe(true);
  });
});
