import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../db/postgres.js", () => ({
  getPool: () => ({ query: vi.fn(async () => ({ rows: [] })) }),
  closePool: vi.fn(),
  checkPostgresHealth: vi.fn(async () => true),
}));

const { buildApp } = await import("../app.js");
const { PROXY_SECRET_HEADER, PROXIED_FOR_HEADER } = await import("../edge-proxy.js");

const SECRET = "test-proxy-secret";
const CLIENT_A = "203.0.113.7";
const CLIENT_B = "198.51.100.9";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, proxySecret: SECRET });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function getMeta(headers: Record<string, string> = {}) {
  return app.inject({ method: "GET", url: "/api/feed/meta", headers });
}

function viaEdge(clientIp: string, secret = SECRET) {
  return { [PROXY_SECRET_HEADER]: secret, [PROXIED_FOR_HEADER]: clientIp };
}

describe("edge proxy gate", () => {
  it("refuses a request that bypassed the edge", async () => {
    const response = await getMeta({ [PROXIED_FOR_HEADER]: CLIENT_A });
    expect(response.statusCode).toBe(403);
  });

  it("refuses a forged secret", async () => {
    const response = await getMeta(viaEdge(CLIENT_A, "guess"));
    expect(response.statusCode).toBe(403);
  });

  it("refuses an edge request without a usable client address", async () => {
    const missing = await getMeta({ [PROXY_SECRET_HEADER]: SECRET });
    const garbage = await getMeta(viaEdge("not-an-ip"));
    expect(missing.statusCode).toBe(403);
    expect(garbage.statusCode).toBe(403);
  });

  it("refuses a direct POST to /mcp before any work runs", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "content-type": "application/json" },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(response.statusCode).toBe(403);
  });

  it("leaves the healthcheck open", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
  });

  it("serves edge requests", async () => {
    const response = await getMeta(viaEdge(CLIENT_A));
    expect(response.statusCode).toBe(200);
  });

  // The whole point: one bucket per client, not one per CDN node.
  it("rate-limits per proxied client, not per socket peer", async () => {
    const first = await getMeta(viaEdge(CLIENT_B));
    const second = await getMeta(viaEdge(CLIENT_B));
    const other = await getMeta(viaEdge("2001:db8::1"));

    const remaining = (response: { headers: Record<string, unknown> }) =>
      Number(response.headers["x-ratelimit-remaining"]);
    expect(remaining(second)).toBe(remaining(first) - 1);
    expect(remaining(other)).toBe(remaining(first));
  });
});
