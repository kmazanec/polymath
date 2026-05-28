import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for desktop Chromium e2e tests.
 *
 * Tests live under apps/web/e2e/ and use @playwright/test — a completely
 * separate runner from vitest, which only picks up src/**\/*.test.{ts,tsx}.
 * These specs are therefore invisible to `pnpm --filter @polymath/web test`.
 *
 * The webServer block starts the Vite dev server if one is not already running
 * on :5173 (reuseExistingServer: true). Network calls to /api/* and /agent are
 * stubbed inside each spec via page.route() — no backend required.
 *
 * Fake-device launch args grant a synthetic microphone track without a real
 * audio device or a browser permission dialog, so getUserMedia succeeds silently
 * in headless CI exactly as it would on a permissioned desktop browser.
 */
export default defineConfig({
  testDir: 'e2e',

  use: {
    baseURL: 'http://localhost:5173',
    // Pre-grant microphone permission so the OS-level prompt never blocks a test.
    permissions: ['microphone'],
    launchOptions: {
      args: [
        // Inject a fake audio capture device — no real mic required.
        '--use-fake-device-for-media-stream',
        // Auto-approve all getUserMedia permission requests.
        '--use-fake-ui-for-media-stream',
      ],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // Runs the Vite dev server. `reuseExistingServer: true` skips the boot if
    // :5173 is already occupied (e.g. a manual `pnpm dev` is running).
    command: 'pnpm --filter @polymath/web dev',
    port: 5173,
    reuseExistingServer: true,
  },
});
