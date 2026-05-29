import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The baseline SPA is served under /baseline/ (a subpath of polymath.biograph.dev
// via the shared Caddy `handle /baseline*`), so the bundle's asset URLs must be
// base-prefixed. In dev, /api is proxied to the agent (the baseline routes live on
// apps/agent — topology D2), so the browser stays single-origin.
const agentHttp = process.env.AGENT_ORIGIN ?? 'http://localhost:8080';

export default defineConfig({
  base: '/baseline/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': agentHttp,
    },
  },
});
