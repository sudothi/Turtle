import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { clientEvent, type ServerEvent } from "@turtle/protocol";

export function buildApp() {
  const app = Fastify({ logger: false });
  app.register(websocket);

  app.get("/health", async () => ({ ok: true }));

  app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket) => {
      socket.on("message", (raw: Buffer) => {
        try {
          const evt = clientEvent.parse(JSON.parse(raw.toString()));
          if (evt.t === "ping") {
            const reply: ServerEvent = { t: "pong" };
            socket.send(JSON.stringify(reply));
          }
        } catch {
          socket.close(1003, "invalid event");
        }
      });
    });
  });

  return app;
}
