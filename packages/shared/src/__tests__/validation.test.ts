import { describe, it, expect } from "vitest";
import { validateGraphNode, validateFeedItem } from "../validation.js";
import type { GraphNode, FeedItem } from "../types.js";

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

const validFeedItem: FeedItem = {
  id: "anthropic/claude-4/launch",
  title: "Claude 4 general availability",
  url: "https://anthropic.com/claude-4",
  source: "anthropic-blog",
  published_at: "2025-06-01T00:00:00Z",
  excerpt: "Anthropic's flagship frontier model is now generally available.",
  vertical: "foundation_models",
  event_type: "launch",
  significance: 0.95,
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

  it("rejects a non-object event without throwing", () => {
    const result = validateGraphNode({ ...validNode, events: [null] });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("events[0] must be an object");
  });

  it("rejects a non-ISO date string that Date can still parse", () => {
    const result = validateGraphNode({ ...validNode, discovered_at: "March 4, 2026" });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("discovered_at must be a valid ISO timestamp");
  });

  it("rejects a javascript: event source_url", () => {
    const result = validateGraphNode({
      ...validNode,
      events: [{ ...validNode.events[0], source_url: "javascript:alert(1)" }],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("events[0].source_url must be a non-empty http(s) URL");
  });
});

describe("validateFeedItem", () => {
  it("accepts a valid feed item", () => {
    const result = validateFeedItem(validFeedItem);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts nullable fields set to null", () => {
    const result = validateFeedItem({
      ...validFeedItem,
      excerpt: null,
      vertical: null,
      event_type: null,
      significance: null,
    });
    expect(result.isValid).toBe(true);
  });

  it("accepts an empty-string excerpt", () => {
    const result = validateFeedItem({ ...validFeedItem, excerpt: "" });
    expect(result.isValid).toBe(true);
  });

  it("accepts significance boundary values 0 and 1", () => {
    expect(validateFeedItem({ ...validFeedItem, significance: 0 }).isValid).toBe(true);
    expect(validateFeedItem({ ...validFeedItem, significance: 1 }).isValid).toBe(true);
  });

  it("rejects null input", () => {
    const result = validateFeedItem(null);
    expect(result.isValid).toBe(false);
  });

  it("rejects a non-object primitive input", () => {
    const result = validateFeedItem("not an object");
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("FeedItem must be an object");
  });

  it("rejects missing id", () => {
    const result = validateFeedItem({ ...validFeedItem, id: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("id must be a non-empty string");
  });

  it("rejects missing title", () => {
    const result = validateFeedItem({ ...validFeedItem, title: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("title must be a non-empty string");
  });

  it("rejects missing source", () => {
    const result = validateFeedItem({ ...validFeedItem, source: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("source must be a non-empty string");
  });

  it("rejects missing url", () => {
    const result = validateFeedItem({ ...validFeedItem, url: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("url must be a non-empty http(s) URL");
  });

  it("rejects a javascript: URL", () => {
    const result = validateFeedItem({ ...validFeedItem, url: "javascript:alert(1)" });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("url must be a non-empty http(s) URL");
  });

  it("rejects a data: URL", () => {
    const result = validateFeedItem({ ...validFeedItem, url: "data:text/html,<script>1</script>" });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("url must be a non-empty http(s) URL");
  });

  it("rejects a non-string, non-null excerpt", () => {
    const result = validateFeedItem({ ...validFeedItem, excerpt: 42 });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("excerpt must be a string or null");
  });

  it("rejects invalid published_at", () => {
    const result = validateFeedItem({ ...validFeedItem, published_at: "not-a-date" });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("published_at must be a valid ISO timestamp");
  });

  it("rejects invalid vertical", () => {
    const result = validateFeedItem({ ...validFeedItem, vertical: "unknown" });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/vertical must be null or one of/);
  });

  it("rejects invalid event_type", () => {
    const result = validateFeedItem({ ...validFeedItem, event_type: "unknown" });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/event_type must be null or one of/);
  });

  it("rejects significance out of range", () => {
    const result = validateFeedItem({ ...validFeedItem, significance: 1.5 });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("significance must be null or a number between 0 and 1");
  });
});
