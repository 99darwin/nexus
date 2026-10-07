/**
 * Trust boundary between the Vercel edge and this API.
 *
 * Railway fronts the container with a CDN, so the socket peer — and the last
 * X-Forwarded-For hop — is one of a handful of CDN nodes, not the client.
 * Keying rate limits on that pools every visitor behind a node into one
 * bucket, and a ban on it bans all of them. Railway publishes no proxy CIDR
 * and no overwrite guarantee for its forwarded headers, so nothing it passes
 * along can be trusted as the client address.
 *
 * Vercel can be. Its rewrite stamps every proxied request with a shared
 * secret (vercel.json `transforms`, value from the deployment env) and sets
 * `x-vercel-proxied-for` to the address it accepted the connection from,
 * overwriting any client-supplied value. (Its `x-vercel-forwarded-for` is
 * passed through as the client sent it — never use that one.)
 *
 * So when PROXY_SECRET is set, every request must carry it, and the client
 * identity is read from `x-vercel-proxied-for`. Requests that reach the
 * Railway domain directly are refused: they could otherwise pick their own
 * identity. Health stays open for Railway's healthcheck, which has no secret.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import { clientKey } from "./client-key.js";

export const PROXY_SECRET_HEADER = "x-proxy-secret";
export const PROXIED_FOR_HEADER = "x-vercel-proxied-for";

const HEALTH_PATH = "/api/health";

declare module "fastify" {
  interface FastifyRequest {
    /** Rate-limit identity: the client address, IPv6 collapsed to its /64. */
    clientKey: string;
  }
}

/** Hashing first gives timingSafeEqual equal-length inputs without leaking the length. */
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function isSecretValid(presented: unknown, secret: string): boolean {
  if (typeof presented !== "string") return false;
  return timingSafeEqual(digest(presented), digest(secret));
}

function proxiedFor(request: FastifyRequest): string | undefined {
  const value = request.headers[PROXIED_FOR_HEADER];
  return typeof value === "string" && isIP(value) !== 0 ? value : undefined;
}

/** Railway's healthcheck carries no secret and has no client behind it. */
export function isHealthCheck(request: FastifyRequest): boolean {
  return request.url.split("?", 1)[0] === HEALTH_PATH;
}

function refuse(reply: FastifyReply): FastifyReply {
  return reply.code(403).send({ error: "forbidden" });
}

/**
 * onRequest hook that resolves `request.clientKey` and, when `secret` is
 * set, refuses anything that did not come through the Vercel rewrite.
 *
 * Must run before @fastify/rate-limit, which keys on `request.clientKey`.
 */
export function edgeProxyHook(secret: string | undefined): onRequestAsyncHookHandler {
  return async (request, reply) => {
    if (!secret || isHealthCheck(request)) {
      request.clientKey = clientKey(request.ip);
      return;
    }

    if (!isSecretValid(request.headers[PROXY_SECRET_HEADER], secret)) return refuse(reply);

    // Valid secret but no usable address means the edge config is broken;
    // falling back to request.ip would silently re-pool every client.
    const address = proxiedFor(request);
    if (!address) {
      request.log.error("proxied request without a valid x-vercel-proxied-for");
      return refuse(reply);
    }
    request.clientKey = clientKey(address);
  };
}
