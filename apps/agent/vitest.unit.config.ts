/**
 * Vitest config for pure unit tests that need no Postgres.
 *
 * Use for voice-layer tests that use MockRealtimeSession + stub db:
 *   npx vitest run --config vitest.unit.config.ts src/voice/transcriptChunk.test.ts
 *   npx vitest run --config vitest.unit.config.ts src/voice/startBridge.test.ts
 *
 * This config intentionally omits `globalSetup` (no Postgres provisioning) so
 * the tests run offline, deterministically, with no Docker dependency.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'agent-unit',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    // No globalSetup: these tests don't need Postgres.
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
