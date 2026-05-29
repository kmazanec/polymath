/**
 * Desktop Chromium e2e — session-report print stylesheet (DEFERRED scaffold).
 *
 * The session-report view ships a `@media print` block that collapses the tile grid
 * to a clean single-page PDF and hides the operator-secret form (AC#3). The intended
 * verification is a Playwright visual-regression: emulate print media, snapshot the
 * page, and diff against a committed baseline.
 *
 * Why this is DEFERRED (skipped, not deleted):
 *   - Playwright visual-regression (toHaveScreenshot baselines) is NOT yet wired in
 *     this codebase — there is no committed baseline directory, no per-platform
 *     baseline policy, and CI does not run the e2e project. Committing a live
 *     screenshot assertion now would either fail on the missing baseline or silently
 *     generate a platform-specific one that breaks on the next runner.
 *   - The print CSS itself is exercised deterministically by the jsdom component
 *     test (the tiles/auth-form structure the print rules target) and by the manual
 *     QA below.
 *
 * This file documents the intended check so the gap is explicit and easy to pick up
 * once the visual-regression harness lands; it is `test.fixme`d so it never blocks CI.
 */

import { expect, test } from '@playwright/test';

const FIXED_SESSION_ID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';

const EXPERIMENT_SUMMARY = {
  preTestScore: 0.25,
  postTestScore: 0.75,
  growthMultiplier: 2.0,
  timeOnTaskMs: 600_000,
  transferSuccessRate: 1,
  masteryStatus: 'mastered',
  explainBackVerdict: { passed: true, reasons: [] },
  kcsMastered: ['AND', 'OR'],
  kcsStuck: [],
  source: 'experiment',
};

test.describe('Session report — print stylesheet (visual regression)', () => {
  // Deferred: enable once the visual-regression baseline harness is wired (see header).
  test.fixme('renders a clean single-page PDF under print media', async ({ page }) => {
    await page.route(/\/api\/session\/[^/]+\/report$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(EXPERIMENT_SUMMARY),
      });
    });

    await page.goto(`/session/${FIXED_SESSION_ID}/report`);
    await page.waitForSelector('.session-report__tile--growth');

    // Emulate print media so the @media print rules apply, then snapshot.
    await page.emulateMedia({ media: 'print' });
    // The operator-secret form must not print.
    await expect(page.locator('.session-report__auth')).toHaveCount(0);
    await expect(page).toHaveScreenshot('session-report-print.png', { fullPage: true });
  });
});
