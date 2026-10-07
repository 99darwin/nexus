import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../db/postgres.js", () => ({
  getPool: () => ({ query: vi.fn(async () => ({ rows: [] })) }),
  closePool: vi.fn(),
  checkPostgresHealth: vi.fn(async () => true),
}));

const { buildApp } = await import("../app.js");
const { parseGatewayKeys } = await import("../gateway.js");
const { resetMcpState } = await import("../routes/mcp.js");
const { isDenied, resetDenylist } = await import("../denylist.js");
const { PROXY_SECRET_HEADER, PROXIED_FOR_HEADER } = await import("../edge-proxy.js");

const SECRET = "test-proxy-secret";
const GATEWAY = "203.0.113.50";
const AGENT = "198.51.100.20";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, proxySecret: SECRET, gatewayKeys: ` ${GATEWAY} ,` });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  resetMcpState();
  resetDenylist();
});

function postMcp(clientIp: string) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      "content-type": "application/json",
      [PROXY_SECRET_HEADER]: SECRET,
      [PROXIED_FOR_HEADER]: clientIp,
    },
    payload: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
}

async function countUntilLimited(clientIp: string, ceiling: number): Promise<number> {
  for (let i = 1; i <= ceiling; i += 1) {
    if ((await postMcp(clientIp)).statusCode === 429) return i;
  }
  return Infinity;
}

describe("MCP gateways", () => {
  it("normalizes listed keys like request.clientKey", () => {
    expect(parseGatewayKeys("::ffff:203.0.113.7, 2001:db8:0:1::5,,")).toEqual(
      new Set(["203.0.113.7", "2001:db8:0:1::/64"]),
    );
    expect(parseGatewayKeys(undefined).size).toBe(0);
  });

  it("gives a listed gateway ten times the burst budget", async () => {
    expect(await countUntilLimited(AGENT, 40)).toBe(31);
    expect(await countUntilLimited(GATEWAY, 400)).toBe(301);
  });

  // A ban would cut off every agent behind the gateway at once.
  it("never bans a gateway, however often it breaches", async () => {
    const start = Date.now();
    let offset = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => start + offset);
    try {
      for (let breach = 0; breach < 6; breach += 1) {
        await countUntilLimited(GATEWAY, 400);
        offset += 60 * 1000;
      }
      expect(isDenied(GATEWAY)).toBe(false);
      expect((await postMcp(GATEWAY)).statusCode).not.toBe(429);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
