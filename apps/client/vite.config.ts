import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const server = "http://localhost:3000";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/auth": server, "/me": server, "/channels": server, "/invites": server, "/health": server,
      "/ws": { target: server, ws: true },
    },
  },
});
