import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

const { mockQuery, mockRelease } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockRelease: vi.fn(),
}));

vi.mock("../db/postgres.js", () => ({
  getPool: () => ({
    query: mockQuery,
    connect: async () => ({ query: mockQuery, release: mockRelease }),
  }),
  closePool: vi.fn(),
  checkPostgresHealth: vi.fn(async () => true),
}));

const sqlOf = (call: unknown[]): string => String(call[0]);
const allSql = (): string[] => mockQuery.mock.calls.map(sqlOf);

/** Locate the mocked query call whose SQL contains `fragment`. */
const callWith = (fragment: string): [string, unknown[]] => {
  const call = mockQuery.mock.calls.find((c: unknown[]) => sqlOf(c).includes(fragment));
  if (!call) throw new Error(`no query matched ${fragment}`);
  return call as [string, unknown[]];
};

const { buildApp } = await import("../app.js");

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

const row = (id: string, publishedAt: string, title: string) => ({
  id,
  title,
  url: `https://example.com/${id}`,
  source: "arxiv",
  published_at: new Date(publishedAt),
  // Rendered by Postgres at microsecond precision alongside the Date column.
  cursor_key: publishedAt,
  excerpt: "an excerpt",
  vertical: "agents",
  event_type: "release",
  significance: 0.6,
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  mockQuery.mockReset();
  mockRelease.mockReset();
});

describe("GET /api/feed", () => {
  it("returns items and a next_cursor when the page is full", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        row(UUID_A, "2026-09-18T10:00:00.000Z", "one"),
        row(UUID_B, "2026-09-17T10:00:00.000Z", "two"),
      ],
    });

    const response = await app.inject({ method: "GET", url: "/api/feed?limit=2" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toEqual({
      id: UUID_A,
      title: "one",
      url: `https://example.com/${UUID_A}`,
      source: "arxiv",
      published_at: "2026-09-18T10:00:00.000Z",
      excerpt: "an excerpt",
      vertical: "agents",
      event_type: "release",
      significance: 0.6,
    });
    expect(body.next_cursor).toBe(`2026-09-17T10:00:00.000Z,${UUID_B}`);
  });

  // Otherwise the same query means different things on a UTC box and a
  // local-time one, because JS reads a zone-less timestamp as local.
  it("reads a zone-less since as UTC", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await app.inject({ method: "GET", url: "/api/feed?since=2026-01-01T00:00:00" });

    const [, params] = callWith("FROM feed_items");
    expect(params).toContain("2026-01-01T00:00:00.000Z");
  });

  it("accepts an offset at the edge of the supported range", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?since=2026-01-01T00:00:00%2B14:00",
    });

    expect(response.statusCode).toBe(200);
  });

  // Handed to Postgres bare, a date-only value resolves in the session
  // timezone, so the same cursor would mean different instants per server.
  it("anchors a date-only cursor to UTC", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const response = await app.inject({
      method: "GET",
      url: `/api/feed?cursor=${encodeURIComponent(`2026-01-01,${UUID_A}`)}`,
    });

    expect(response.statusCode).toBe(200);
    const [, params] = callWith("(published_at, id) <");
    expect(params).toContain("2026-01-01T00:00:00Z");
  });

  it("accepts a real leap day", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const response = await app.inject({ method: "GET", url: "/api/feed?since=2024-02-29" });

    expect(response.statusCode).toBe(200);
    const [, params] = callWith("FROM feed_items");
    expect(params).toContain("2024-02-29T00:00:00.000Z");
  });

  // published_at is a timestamptz (microseconds) but node-postgres hands back
  // a millisecond JS Date. A cursor built from that truncates downward and the
  // keyset predicate then skips whatever sat in the sub-millisecond gap.
  it("builds the cursor from the microsecond key, not the truncated Date", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          ...row(UUID_A, "2026-09-18T10:00:00.000Z", "one"),
          cursor_key: "2026-09-18T10:00:00.000123Z",
        },
        {
          ...row(UUID_B, "2026-09-17T10:00:00.000Z", "two"),
          cursor_key: "2026-09-17T10:00:00.999888Z",
        },
      ],
    });

    const response = await app.inject({ method: "GET", url: "/api/feed?limit=2" });

    const [sql] = callWith("FROM feed_items");
    expect(sql).toContain("AS cursor_key");
    expect(response.json().next_cursor).toBe(`2026-09-17T10:00:00.999888Z,${UUID_B}`);
  });

  // Losing pagination is recoverable; silently skipping rows is not.
  it("withholds the cursor rather than emitting a truncated one", async () => {
    const { cursor_key: _omitted, ...withoutKey } = row(UUID_A, "2026-09-18T10:00:00.000Z", "one");
    mockQuery.mockResolvedValue({ rows: [withoutKey] });

    const response = await app.inject({ method: "GET", url: "/api/feed?limit=1" });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().next_cursor).toBeNull();
  });

  it("round-trips microsecond precision back into the keyset predicate", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const cursor = `2026-09-17T10:00:00.999888Z,${UUID_B}`;

    const response = await app.inject({
      method: "GET",
      url: `/api/feed?cursor=${encodeURIComponent(cursor)}`,
    });

    expect(response.statusCode).toBe(200);
    const [, params] = callWith("(published_at, id) <");
    // Not re-normalised through Date, which would drop the last three digits.
    expect(params).toContain("2026-09-17T10:00:00.999888Z");
  });

  it("sets baseline security headers", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const response = await app.inject({ method: "GET", url: "/api/feed" });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("returns a null cursor when the page is short", async () => {
    mockQuery.mockResolvedValue({ rows: [row(UUID_A, "2026-09-18T10:00:00.000Z", "one")] });

    const response = await app.inject({ method: "GET", url: "/api/feed?limit=50" });

    expect(response.json().next_cursor).toBeNull();
  });

  it("round-trips a cursor back into the keyset predicate", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        row(UUID_A, "2026-09-18T10:00:00.000Z", "one"),
        row(UUID_B, "2026-09-17T10:00:00.000Z", "two"),
      ],
    });
    const first = await app.inject({ method: "GET", url: "/api/feed?limit=2" });
    const cursor = first.json().next_cursor as string;

    mockQuery.mockResolvedValue({ rows: [] });
    const second = await app.inject({
      method: "GET",
      url: `/api/feed?limit=2&cursor=${encodeURIComponent(cursor)}`,
    });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ items: [], next_cursor: null });

    const [sql, params] = callWith("(published_at, id) <");
    expect(params).toContain("2026-09-17T10:00:00.000Z");
    expect(params).toContain(UUID_B);
  });

  it("binds every filter as a parameter", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?vertical=agents&event_type=funding&source=hackernews&since=2026-01-01T00:00:00.000Z",
    });

    expect(response.statusCode).toBe(200);
    const [sql, params] = callWith("FROM feed_items");
    expect(sql).toContain("vertical = $1");
    expect(sql).toContain("event_type = $2");
    expect(sql).toContain("source = $3");
    expect(sql).toContain("published_at >= $4");
    expect(params.slice(0, 4)).toEqual([
      "agents",
      "funding",
      "hackernews",
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("filters on the indexable trigram operator and ranks by similarity", async () => {
    mockQuery.mockResolvedValue({ rows: [row(UUID_A, "2026-09-18T10:00:00.000Z", "one")] });

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?q=funding%20round&limit=1",
    });

    expect(response.statusCode).toBe(200);
    // Relevance ordering has no stable keyset, so no cursor is offered.
    expect(response.json().next_cursor).toBeNull();

    const [sql, params] = callWith("FROM feed_items");
    // `%` is the only form that consults the GIN trigram index.
    expect(sql).toContain("coalesce(excerpt, '') % $1");
    expect(sql).toContain("ORDER BY similarity(");
    expect(params).toContain("funding round");

    // The lowered threshold must be transaction-local, not leaked to the pool.
    const [thresholdSql, thresholdParams] = callWith("set_config");
    expect(thresholdSql).toContain("pg_trgm.similarity_threshold");
    expect(thresholdParams).toEqual(["0.08"]);
    expect(allSql()).toContain("BEGIN READ ONLY");
    expect(allSql()).toContain("COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("releases the pooled client and hides db detail when a search fails", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM feed_items")) {
        throw new Error("relation feed_items does not exist at 10.0.0.4:5432");
      }
      return { rows: [] };
    });

    const response = await app.inject({ method: "GET", url: "/api/feed?q=funding" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal error" });
    expect(response.body).not.toContain("10.0.0.4");
    expect(allSql()).toContain("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["malformed cursor", "/api/feed?cursor=not-a-cursor"],
    ["non-uuid cursor id", "/api/feed?cursor=2026-09-17T10:00:00.000Z,abc"],
    ["non-date cursor timestamp", `/api/feed?cursor=yesterday,${UUID_A}`],
    ["non-numeric limit", "/api/feed?limit=abc"],
    ["limit above the cap", "/api/feed?limit=500"],
    ["limit below the floor", "/api/feed?limit=0"],
    ["unknown vertical", "/api/feed?vertical=not_a_vertical"],
    ["unknown event_type", "/api/feed?event_type=exploded"],
    ["non-date since", "/api/feed?since=whenever"],
    // Date.parse("0") succeeds; "0"::timestamptz does not.
    ["a since Postgres would reject", "/api/feed?since=0"],
    ["a bare year as since", "/api/feed?since=2026"],
    ["a repeated q parameter", "/api/feed?q=a&q=b"],
    ["a repeated since parameter", "/api/feed?since=2026-01-01&since=2026-02-01"],
    // Matches the ISO shape, but PostgreSQL timestamptz starts at year 0001.
    ["year zero", "/api/feed?since=0000-01-01"],
    // new Date() would silently roll these forward and change the query.
    ["feb 29 in a common year", "/api/feed?since=2026-02-29"],
    ["a 13th month", "/api/feed?since=2026-13-01"],
    ["a 31st of april", "/api/feed?since=2026-04-31"],
    // JS accepts offsets to +/-23:59; Postgres timestamptz stops at +/-15.
    ["an out-of-range utc offset", "/api/feed?since=2026-01-01T00:00:00%2B16:00"],
    [
      "an out-of-range offset in a cursor",
      `/api/feed?cursor=2026-01-01T00:00:00%2B16:00,${UUID_A}`,
    ],
    ["a nonsense offset minute", "/api/feed?since=2026-01-01T00:00:00%2B02:99"],
    ["cursor combined with q", `/api/feed?q=models&cursor=2026-09-17T10:00:00.000Z,${UUID_A}`],
  ])("rejects %s with 400", async (_label, url) => {
    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toEqual(expect.any(String));
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("GET /api/feed/meta", () => {
  it("returns facet counts and a total", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY vertical")) {
        return { rows: [{ vertical: "agents", count: "12" }] };
      }
      if (sql.includes("GROUP BY event_type")) {
        return { rows: [{ event_type: "funding", count: "3" }] };
      }
      return { rows: [{ total: "15" }] };
    });

    const response = await app.inject({ method: "GET", url: "/api/feed/meta" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      verticals: { agents: 12 },
      event_types: { funding: 3 },
      total: 15,
    });
  });
});
