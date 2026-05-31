import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const agentHttp = process.env.AGENT_ORIGIN ?? 'http://localhost:8080';
const agentWs = agentHttp.replace(/^http/, 'ws');

// When the dev server runs INSIDE the compose stack behind Caddy (the
// docker-compose.override.yml dev workflow), the browser reaches it through Caddy
// on the published host port, NOT on Vite's internal port. Vite's HMR client must be
// told that public port so its hot-reload websocket connects back through Caddy.
// `HMR_CLIENT_PORT` is set by the override (8080); unset for the plain `pnpm dev`
// (:5173) workflow, where Vite's defaults already work. (dev-stack HMR.)
const hmrClientPort = process.env.HMR_CLIENT_PORT
  ? Number(process.env.HMR_CLIENT_PORT)
  : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    // In the container, listen on all interfaces so Caddy can reach it.
    host: true,
    proxy: {
      // Dev: forward API + WS to the agent service so the browser uses a single origin.
      // Behind Caddy these paths never hit Vite (Caddy routes them to the agent first);
      // for the bare `pnpm dev` (:5173) workflow, Vite proxies them to AGENT_ORIGIN.
      '/api': agentHttp,
      '/agent': { target: agentWs, ws: true },
    },
    // HMR: when fronted by Caddy, the client connects to the public host port.
    ...(hmrClientPort ? { hmr: { clientPort: hmrClientPort } } : {}),
  },
});
