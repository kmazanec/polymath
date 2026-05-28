import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const agentHttp = process.env.AGENT_ORIGIN ?? 'http://localhost:8080';
const agentWs = agentHttp.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Dev: forward API + WS to the agent service so the browser uses a single origin.
      '/api': agentHttp,
      '/agent': { target: agentWs, ws: true },
    },
  },
});
