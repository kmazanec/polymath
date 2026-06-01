import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for desktop Chromium + tablet touch e2e tests.
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
 *
 * Projects:
 *  - chromium:  Desktop Chrome (existing e2e specs)
 *  - tablet:    iPad Pro device profile (hasTouch:true, 1024×1366) — F-31
 *               touch drive. `boundingBox()` assertions in touch.spec.ts are
 *               the ONLY real-size checks (jsdom returns 0×0; size tests there
 *               are forbidden false-greens).
 */
export default defineConfig({
  testDir: 'e2e',

  use: {
    baseURL: `http://localhost:${process.env['VITE_PORT'] ?? '5173'}`,
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
    /**
     * F-31 tablet project — emulates an iPad Pro with touch events enabled.
     * `devices['iPad Pro']` sets:
     *   viewport: 1024×1366, isMobile: true, hasTouch: true,
     *   userAgent: iPad Safari, deviceScaleFactor: 2
     * The touch.spec.ts file runs ONLY on this project (testMatch filter).
     */
    /**
     * F-31 tablet project — custom touch viewport at tablet-landscape width.
     * Uses `Desktop Chrome` base (chromium — matches CI) with touch enabled and
     * an 1024×768 viewport (> 56rem breakpoint) so the left-rail stays visible.
     * `hasTouch: true` is what exercises pointer-event drag and tap semantics.
     */
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        // Enable touch events — the critical flag for F-31's touch contract.
        hasTouch: true,
        isMobile: false,
        // 1024×768 landscape tablet — wider than 56rem (896px) so the rail renders.
        viewport: { width: 1024, height: 768 },
        // Keep the fake media args so voice tests don't need a real mic.
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
          ],
        },
      },
      testMatch: ['**/e2e/touch.spec.ts'],
    },
  ],

  webServer: {
    // Runs the Vite dev server. `reuseExistingServer: true` skips the boot if
    // :5173 is already occupied (e.g. a manual `pnpm dev` is running).
    // NOTE: In the F-31 worktree, the primary worktree may be running on :5173.
    // If tests pick up a stale server, set VITE_PORT=5174 before running.
    command: process.env['VITE_PORT']
      ? `pnpm --filter @polymath/web exec vite --port ${process.env['VITE_PORT']}`
      : 'pnpm --filter @polymath/web dev',
    port: process.env['VITE_PORT'] ? Number(process.env['VITE_PORT']) : 5173,
    reuseExistingServer: !process.env['VITE_PORT'],
  },
});
