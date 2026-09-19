import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Constant-time comparison via fixed-width digests.
 *
 * Comparing raw buffers required a length guard first, and a JavaScript
 * string length is UTF-16 units while the buffer is UTF-8 bytes: a multibyte
 * header of the same character length produced buffers of different byte
 * lengths, which makes timingSafeEqual throw. That turned into a 500 where a
 * wrong key gives a 401 — an oracle for the configured key's length. Digests
 * are always 32 bytes, so the comparison is total and the length is hidden.
 */
function safeCompare(a: string, b: string): boolean {
  const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}

export async function requireApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers["x-api-key"];
  const expectedKey = process.env.API_KEY;

  if (!expectedKey) {
    // Opaque to the caller — server configuration state is not theirs to read.
    request.log.error("API_KEY is not configured; admin routes are unavailable");
    reply.code(500).send({ error: "internal error" });
    return;
  }

  if (!apiKey || typeof apiKey !== "string" || !safeCompare(apiKey, expectedKey)) {
    reply.code(401).send({ error: "Invalid or missing API key" });
    return;
  }
}
