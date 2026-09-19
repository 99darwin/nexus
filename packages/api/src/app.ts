import Fastify, { type FastifyInstance, type FastifyError } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { clientKey } from "./client-key.js";
import { healthRoutes } from "./routes/health.js";
import { feedRoutes } from "./routes/feed.js";
import { chatRoutes } from "./routes/chat.js";
import { dashboardRoutes } from "./routes/admin/dashboard.js";

export interface BuildAppOptions {
  logger?: boolean;
  /** Overrides TRUST_PROXY. See `resolveTrustProxy`. */
  trustProxy?: boolean | string | number;
}

/**
 * How far to trust X-Forwarded-For when deriving `request.ip`.
 *
 * This is the rate limiter's identity, so it must not be attacker-chosen.
 * Fastify ignores forwarded headers entirely unless this is set, which is the
 * right default for a directly-exposed origin. Behind a proxy set TRUST_PROXY
 * to the hop count (`1` for a single load balancer) or a CIDR list — never to
 * `true` unless clients cannot reach the origin directly, since that trusts
 * the whole forwarded chain.
 */
function resolveTrustProxy(override?: boolean | string | number): boolean | string | number {
  if (override !== undefined) return override;
  const configured = process.env.TRUST_PROXY;
  if (!configured) return false;
  // Fastify reads a leftover string as a CIDR and aborts startup with
  // "invalid IP address: false", so the explicit opt-out must be handled here.
  if (configured === "false") return false;
  if (configured === "true") {
    if (process.env.NODE_ENV === "production") {
      // `true` trusts the entire forwarded chain, so a client-supplied
      // X-Forwarded-For that the edge did not strip becomes the rate-limit
      // identity — spoofable, and usable to ban a chosen victim.
      console.warn(
        "[api] TRUST_PROXY=true trusts the whole X-Forwarded-For chain; " +
          "prefer a hop count (e.g. 1) or a proxy CIDR in production",
      );
    }
    return true;
  }
  if (/^\d+$/.test(configured)) return parseInt(configured, 10);
  return configured;
}

/**
 * Assembles the server without binding a port, so tests can drive it
 * through `app.inject()`.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({
    logger: options.logger ?? true,
    trustProxy: resolveTrustProxy(options.trustProxy),
  });

  const configuredOrigin = process.env.CLIENT_ORIGIN;
  if (!configuredOrigin && process.env.NODE_ENV === "production") {
    // Fail fast rather than shipping a wildcard by omission.
    throw new Error("CLIENT_ORIGIN must be set in production");
  }
  const corsOrigin = configuredOrigin
    ? configuredOrigin.split(",").map((origin) => origin.trim())
    : "*";
  // Baseline hardening. This is a JSON API, so there is no CSP to speak of —
  // these are the headers that still matter without pulling in helmet.
  //
  // onRequest rather than onSend: a root-level onSend hook runs a second time
  // over replies the error handler produces and double-writes the head. And
  // registered *before* cors, because a CORS preflight is answered by the cors
  // hook itself — anything registered after it never runs for an OPTIONS.
  server.addHook("onRequest", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    if (process.env.NODE_ENV === "production") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });

  await server.register(cors, { origin: corsOrigin });

  // Outer net. /api/chat adds a tighter per-IP window of its own, keyed the
  // same way — if this one keyed on the full address it would be the cheap
  // way around the strict one for any IPv6 client.
  await server.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (request) => clientKey(request.ip),
  });

  // Fastify's default handler echoes `error.message` on a 500, which for an
  // unhandled DB failure means connection strings and table names reach the
  // client. Detail stays in the log; the body stays opaque.
  server.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, "unhandled route error");
      reply.code(status).send({ error: "internal error" });
      return;
    }
    request.log.info({ err: error }, "request rejected");
    reply.code(status).send({ error: error.message });
  });

  await server.register(healthRoutes);
  await server.register(feedRoutes);
  await server.register(chatRoutes);
  await server.register(dashboardRoutes);

  return server;
}
