import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const server = "http://localhost:3000";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/auth": server, "/me": server, "/servers": server, "/channels": server, "/invites": server, "/health": server, "/voice": server, "/users": server, "/files": server, "/friends": server, "/dms": server, "/blocks": server, "/admin": server, "/unread": server, "/messages": server, "/sounds": server,
      "/waitlist": server,
      "/ws": { target: server, ws: true },
    },
  },
});
