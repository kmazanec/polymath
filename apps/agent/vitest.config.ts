import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'agent',
    include: ['src/**/*.test.ts'],
    // The integration + seed suites share one Postgres (and the transfer_bank
    // table), so they must not run concurrently — run test files serially. The
    // agent suite is small; the safety is worth more than the parallelism.
    fileParallelism: false,
    // The integration test boots a real WS server + Postgres.
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
