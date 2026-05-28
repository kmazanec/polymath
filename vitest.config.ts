import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    // Provision the shared test Postgres once, before any project's suites run,
    // so DB-backed suites never race on a cold-start container under the
    // whole-workspace run. No-op with an external DB / no Docker.
    globalSetup: ['./vitest.globalSetup.ts'],
  },
});
