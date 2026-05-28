import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'agent',
    include: ['src/**/*.test.ts'],
    // The integration test boots a real WS server + (optionally) Postgres.
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
