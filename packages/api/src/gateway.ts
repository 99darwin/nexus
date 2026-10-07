/**
 * Trusted MCP gateways: hosts like Smithery that proxy many agents to /mcp
 * from one address.
 *
 * Behind a gateway every agent shares one client key, so the per-client
 * limits would throttle all of them together and an escalation would ban the
 * whole gateway site-wide. Keys listed in MCP_GATEWAY_KEYS get a scaled
 * budget instead and are never auto-banned. Nothing a gateway forwards about
 * the agent behind it is trustworthy, so one noisy agent can still spend the
 * shared budget; that is the cost of listing.
 */

import type { onRequestAsyncHookHandler } from "fastify";
import { clientKey } from "./client-key.js";

/** Budget multiplier for a gateway relative to a single client. */
export const GATEWAY_LIMIT_MULTIPLIER = 10;

declare module "fastify" {
  interface FastifyRequest {
    /** True when request.clientKey is a listed MCP gateway. */
    isGateway: boolean;
  }
}

/** Comma-separated addresses, normalized the way request.clientKey is. */
export function parseGatewayKeys(raw: string | undefined): Set<string> {
  const entries = (raw ?? "").split(",").map((entry) => entry.trim());
  return new Set(entries.filter(Boolean).map(clientKey));
}

/** Must run after edgeProxyHook, which resolves request.clientKey. */
export function gatewayHook(keys: ReadonlySet<string>): onRequestAsyncHookHandler {
  return async (request) => {
    request.isGateway = keys.has(request.clientKey);
  };
}
