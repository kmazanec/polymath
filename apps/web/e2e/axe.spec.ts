/**
 * Desktop Chromium e2e — accessibility audit (@axe-core/playwright)
 *
 * Why a real browser (not just the jsdom jest-axe pass): axe's `color-contrast`
 * rule needs real layout + computed paint, which jsdom does not provide, and the
 * two richest widgets — react-flow (CircuitBuilder) and CodeMirror
 * (PseudocodeChallenge) — do not render meaningfully under jsdom. This spec runs
 * axe against the running app in real Chromium and gates on ZERO serious/critical
 * violations (AC#1), so contrast + the rich widgets are covered for real.
 *
 * Network is stubbed exactly like voice.spec.ts (no backend): POST /api/session
 * returns a fixed sessionId so the shell renders. The agent WebSocket is NOT
 * interceptable via page.route(), so the live agent-driven mounts (a TruthTable /
 * CircuitBuilder / PseudocodeChallenge pushed by an `action` frame) are not reached
 * here; the jsdom jest-axe pass covers the agent-mounted surfaces structurally, and
 * this pass covers the real-browser shell + the focus-trapped About modal with the
 * contrast rule ENABLED. The deferred half (driving react-flow/CodeMirror in a real
 * browser) needs a WS stub or a real agent and is logged as a known gap.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const FIXED_SESSION_ID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';

async function stubRoutes(page: Parameters<Parameters<typeof test>[1]>[0]): Promise<void> {
  // Catch-all first (lowest LIFO priority): keep unrelated /api/* calls quiet.
  await page.route(/\/api\//, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // POST /api/session — bootstrap so the shell renders.
  await page.route(/\/api\/session$/, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: FIXED_SESSION_ID }),
      });
    } else {
      await route.continue();
    }
  });
}

/** Gate ONLY on serious/critical (the acceptance criterion); minor/moderate are
 *  surfaced in the failure message but not build-failing. */
function failingViolations(
  violations: { id: string; impact?: string | null; help: string; nodes: unknown[] }[],
): typeof violations {
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

test.describe('axe-core audit — real browser (AC#1: 0 serious/critical)', () => {
  test('the running app shell at / has no serious/critical violations (contrast enabled)', async ({
    page,
  }) => {
    await stubRoutes(page);
    await page.goto('/');
    // The shell renders the lesson intro + ask form + the About-session footer.
    await page.waitForSelector('main', { timeout: 10_000 });
    await page.getByRole('button', { name: /about this session/i }).waitFor();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const gating = failingViolations(results.violations);
    expect(
      gating,
      `serious/critical a11y violations:\n${gating
        .map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node[s])`)
        .join('\n')}`,
    ).toEqual([]);
  });

  test('the focus-trapped About-session modal has no serious/critical violations', async ({
    page,
  }) => {
    await stubRoutes(page);
    await page.goto('/');
    await page.getByRole('button', { name: /about this session/i }).click();
    await page.getByRole('dialog').waitFor();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const gating = failingViolations(results.violations);
    expect(
      gating,
      `serious/critical a11y violations:\n${gating
        .map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node[s])`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
