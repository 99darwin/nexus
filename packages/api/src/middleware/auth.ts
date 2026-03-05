import type { FastifyRequest, FastifyReply } from "fastify";

export async function requireApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers["x-api-key"];
  const expectedKey = process.env.API_KEY;

  if (!expectedKey) {
    reply.code(500).send({ error: "API key not configured on server" });
    return;
  }

  if (!apiKey || apiKey !== expectedKey) {
    reply.code(401).send({ error: "Invalid or missing API key" });
  }
}
