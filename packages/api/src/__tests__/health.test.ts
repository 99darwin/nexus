import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

const { mockHealth } = vi.hoisted(() => ({ mockHealth: vi.fn() }));

vi.mock("../db/postgres.js", () => ({
  getPool: () => ({ query: vi.fn(), connect: vi.fn() }),
  closePool: vi.fn(),
  checkPostgresHealth: mockHealth,
}));

const { buildApp } = await import("../app.js");

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  mockHealth.mockReset();
});

describe("GET /api/health", () => {
  it("reports ok while Postgres answers", async () => {
    mockHealth.mockResolvedValue(true);

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.services).toEqual({ postgres: true });
    expect(Date.parse(body.timestamp)).not.toBeNaN();
  });

  // Postgres is the only datastore, so a 200 here would keep a load balancer
  // sending traffic to an instance that cannot serve a single route.
  it("returns 503 when Postgres is unreachable", async () => {
    mockHealth.mockResolvedValue(false);

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe("degraded");
    expect(response.json().services).toEqual({ postgres: false });
  });
});
