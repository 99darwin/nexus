import { describe, it, expect, afterEach } from "vitest";
import { buildApp } from "../app.js";

const previousTrustProxy = process.env.TRUST_PROXY;

afterEach(() => {
  if (previousTrustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = previousTrustProxy;
});

describe("TRUST_PROXY parsing", () => {
  // Passed through as a string, Fastify reads it as a CIDR and aborts startup
  // with "invalid IP address: false" — an explicit opt-out that takes the
  // service down is worse than no setting at all.
  it("treats a literal false as the opt-out, not a CIDR", async () => {
    process.env.TRUST_PROXY = "false";

    const app = await buildApp({ logger: false });
    await app.ready();
    await app.close();
  });

  it("accepts a hop count", async () => {
    process.env.TRUST_PROXY = "1";

    const app = await buildApp({ logger: false });
    await app.ready();
    await app.close();
  });

  it("accepts a proxy CIDR", async () => {
    process.env.TRUST_PROXY = "10.0.0.0/8";

    const app = await buildApp({ logger: false });
    await app.ready();
    await app.close();
  });
});

describe("CORS preflight", () => {
  // The security-header hook must be registered before @fastify/cors, which
  // answers OPTIONS itself — anything registered after it never runs.
  it("carries the security headers on a preflight", async () => {
    const app = await buildApp({ logger: false });
    await app.ready();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/feed",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "GET",
      },
    });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");

    await app.close();
  });
});
