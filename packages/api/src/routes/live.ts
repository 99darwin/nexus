import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";

const clients = new Set<WebSocket>();

export async function liveRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/live", { websocket: true }, (socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
    socket.send(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));
  });
}

export function broadcastMutation(data: {
  type: "node_upsert" | "edge_upsert";
  data: unknown;
}): void {
  const message = JSON.stringify(data);
  for (const client of clients) {
    try {
      client.send(message);
    } catch {
      clients.delete(client);
    }
  }
}
