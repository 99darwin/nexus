import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("../db/postgres.js", () => ({
  getPool: () => ({ query: mockQuery, connect: vi.fn() }),
  closePool: vi.fn(),
  checkPostgresHealth: vi.fn(async () => true),
}));

const { buildApp } = await import("../app.js");

const API_KEY = "s3cret-admin-key";
const URL = "/api/admin/dashboard";

const previousApiKey = process.env.API_KEY;

let app: FastifyInstance;

const get = (headers: Record<string, string> = {}) =>
  app.inject({ method: "GET", url: URL, headers });

beforeAll(async () => {
  process.env.API_KEY = API_KEY;
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  if (previousApiKey === undefined) delete process.env.API_KEY;
  else process.env.API_KEY = previousApiKey;
});

beforeEach(() => {
  mockQuery.mockReset();
  process.env.API_KEY = API_KEY;
  mockQuery.mockResolvedValue({ rows: [{ last_item_at: null, count: "0" }] });
});

describe("GET /api/admin/dashboard auth", () => {
  it("rejects a missing key with 401", async () => {
    const response = await get();

    expect(response.statusCode).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a wrong key with 401", async () => {
    const response = await get({ "x-api-key": "wrong-key" });

    expect(response.statusCode).toBe(401);
  });

  // A multibyte header of the same character length used to blow up
  // timingSafeEqual on a byte-length mismatch. The resulting 500-vs-401 split
  // told an attacker when they had guessed the key's length.
  it("rejects a same-length multibyte key with 401, not 500", async () => {
    const multibyte = "é".repeat(API_KEY.length);
    expect(multibyte.length).toBe(API_KEY.length);

    const response = await get({ "x-api-key": multibyte });

    expect(response.statusCode).toBe(401);
  });

  it("stays opaque when the server has no key configured", async () => {
    delete process.env.API_KEY;

    const response = await get({ "x-api-key": API_KEY });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal error" });
    expect(response.body).not.toContain("API key");
  });

  it("serves the dashboard with the right key and forbids caching", async () => {
    const response = await get({ "x-api-key": API_KEY });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({ feedItemCount: 0, queueDepth: 0 });
  });
});
