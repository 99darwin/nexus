import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function requireApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers["x-api-key"];
  const expectedKey = process.env.API_KEY;

  if (!expectedKey) {
    reply.code(500).send({ error: "API key not configured on server" });
    return;
  }

  if (!apiKey || typeof apiKey !== "string" || !safeCompare(apiKey, expectedKey)) {
    reply.code(401).send({ error: "Invalid or missing API key" });
    return;
  }
}
