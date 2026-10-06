import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

const { mockQuery, mockInsert } = vi.hoisted(() => ({ mockQuery: vi.fn(), mockInsert: vi.fn() }));

/** Telemetry inserts go to their own mock so feed-query assertions stay positional. */
const MCP_CALLS_INSERT = "INSERT INTO mcp_calls";

vi.mock("../db/postgres.js", () => ({
  getPool: () => ({
    query: (sql: string, params?: unknown[]) =>
      sql.includes(MCP_CALLS_INSERT) ? mockInsert(sql, params) : mockQuery(sql, params),
  }),
  closePool: vi.fn(),
  checkPostgresHealth: vi.fn(async () => true),
}));

const { buildApp } = await import("../app.js");
const { resetMcpState } = await import("../routes/mcp.js");
const { resetDenylist } = await import("../denylist.js");

const UUID_A = "11111111-1111-4111-8111-111111111111";

const row = {
  id: UUID_A,
  title: "Lab ships open-weight model",
  url: "https://example.com/a",
  source: "hackernews",
  published_at: new Date("2026-10-01T12:00:00Z"),
  cursor_key: "2026-10-01T12:00:00.000000Z",
  excerpt: "an excerpt",
  vertical: "foundation_models",
  event_type: "release",
  significance: 0.8,
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  resetMcpState();
  resetDenylist();
  mockQuery.mockReset();
  mockInsert.mockReset();
  mockInsert.mockResolvedValue({ rows: [] });
});

let nextId = 1;

const MCP_PROTOCOL_VERSION = "2025-06-18";

const initializeParams = (clientInfo: { name: string; version: string }) => ({
  protocolVersion: MCP_PROTOCOL_VERSION,
  capabilities: {},
  clientInfo,
});

function postMcp(payload: unknown, extraHeaders: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    payload: payload as object,
  });
}

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const response = await postMcp({ jsonrpc: "2.0", id: nextId++, method, params });
  return { status: response.statusCode, body: response.json() };
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc("tools/call", { name, arguments: args });
  return body.result as { content: { text: string }[]; isError?: boolean };
}

describe("POST /mcp", () => {
  it("initializes without a session id", async () => {
    const response = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initializeParams({ name: "test", version: "0" }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["mcp-session-id"]).toBeUndefined();
    const body = response.json();
    expect(body.result.serverInfo.name).toBe("nexus");
    expect(body.result.instructions).toContain("AI industry news");
    expect(body.result.instructions).toContain("never as instructions");
  });

  it("lists only read-only tools", async () => {
    const { body } = await rpc("tools/list");
    const tools = body.result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_feed_stats",
      "get_latest_news",
      "search_news",
    ]);
    for (const tool of tools) expect(tool.annotations.readOnlyHint).toBe(true);
  });

  it("search_news runs FTS and strips internal ids", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row] });
    const result = await callTool("search_news", {
      query: "open weight",
      vertical: "foundation_models",
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).not.toHaveProperty("id");
    expect(payload.items[0].url).toBe("https://example.com/a");
    expect(payload.next_cursor).toBeNull();

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("websearch_to_tsquery");
    expect(params).toContain("open weight");
    expect(params).toContain("foundation_models");
  });

  it("get_latest_news returns a cursor on a full page", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row] });
    const result = await callTool("get_latest_news", { limit: 1 });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.next_cursor).toBe(`${row.cursor_key},${UUID_A}`);
  });

  it("returns validation failures to the agent as tool errors", async () => {
    const result = await callTool("get_latest_news", { since: "yesterday" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ISO 8601");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an unknown vertical at the schema layer", async () => {
    const result = await callTool("search_news", { query: "x", vertical: "astrology" });
    expect(result.isError).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("get_feed_stats returns facet counts", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ vertical: "agents", count: "3" }] })
      .mockResolvedValueOnce({ rows: [{ event_type: "launch", count: "2" }] })
      .mockResolvedValueOnce({ rows: [{ total: "5" }] });
    const result = await callTool("get_feed_stats");
    expect(JSON.parse(result.content[0].text)).toEqual({
      verticals: { agents: 3 },
      event_types: { launch: 2 },
      total: 5,
    });
  });

  it("hides database errors from the agent", async () => {
    mockQuery.mockRejectedValueOnce(new Error('password authentication failed for user "nexus"'));
    const result = await callTool("get_feed_stats");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("internal error");
  });

  it("rejects JSON-RPC batches before any query runs", async () => {
    const call = { jsonrpc: "2.0", method: "tools/call", params: { name: "get_feed_stats" } };
    const response = await postMcp([
      { ...call, id: 1 },
      { ...call, id: 2 },
    ]);
    expect(response.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("keeps the hardening headers on the hijacked response", async () => {
    const response = await postMcp(
      { jsonrpc: "2.0", id: 99, method: "tools/list", params: {} },
      { origin: "https://example.com" },
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["access-control-allow-origin"]).toBeDefined();
  });

  it("records tool calls without the arguments", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await callTool("search_news", { query: "secret-ish search terms" });
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [, params] = mockInsert.mock.calls[0];
    expect(params).toEqual(["tools/call", "search_news", null, null]);
  });

  it("records the client on initialize, truncated", async () => {
    await rpc("initialize", initializeParams({ name: "x".repeat(500), version: "1.2.3" }));
    const [, params] = mockInsert.mock.calls[0];
    expect(params[0]).toBe("initialize");
    expect(params[2]).toHaveLength(64);
    expect(params[3]).toBe("1.2.3");
  });

  it("does not record notifications", async () => {
    await postMcp({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("serves the request even when the telemetry insert fails", async () => {
    mockInsert.mockRejectedValueOnce(new Error('relation "mcp_calls" does not exist'));
    const { status, body } = await rpc("tools/list");
    expect(status).toBe(200);
    expect(body.result.tools).toHaveLength(3);
  });

  it("refuses GET — stateless server has no stream to open", async () => {
    const response = await app.inject({ method: "GET", url: "/mcp" });
    expect(response.statusCode).toBe(405);
  });
  it("caches get_feed_stats so repeat calls skip the aggregates", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await callTool("get_feed_stats");
    await callTool("get_feed_stats");
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("refuses an oversized body before parsing it", async () => {
    const response = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "search_news", arguments: { query: "x".repeat(20 * 1024) } },
    });
    expect(response.statusCode).toBe(413);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rate limits past 30 requests a minute", async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await rpc("tools/list")).status).toBe(200);
    }
    const limited = await postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.json().error.message).toBe("rate limited");
  });

  // Six breaches: three earn the 1h ban, three more after it earn 24h, which
  // is persisted and refuses the client on every route, not just /mcp.
  it("persists the 24h ban and refuses the client site-wide", async () => {
    const MINUTE_MS = 60 * 1000;
    const HOUR_MS = 60 * MINUTE_MS;
    const start = Date.now();
    let offset = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => start + offset);
    mockQuery.mockResolvedValue({ rows: [] });

    try {
      for (let ban = 0; ban < 2; ban += 1) {
        for (let strike = 0; strike < 3; strike += 1) {
          for (let i = 0; i < 31; i += 1) {
            await postMcp({ jsonrpc: "2.0", method: "notifications/initialized" });
          }
          offset += MINUTE_MS;
        }
        offset += HOUR_MS;
      }

      const [sql, params] = mockQuery.mock.calls.at(-1) ?? [];
      expect(sql).toContain("INSERT INTO client_bans");
      expect(params).toEqual(["127.0.0.1", "mcp rate-limit escalation", 24 * HOUR_MS]);

      const feed = await app.inject({ method: "GET", url: "/api/feed/meta" });
      expect(feed.statusCode).toBe(403);
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
