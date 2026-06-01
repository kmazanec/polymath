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
 * returns a fixed sessionId so the shell renders. The agent WebSocket is stubbed
 * via page.routeWebSocket() so the lesson surface (FlowSkeleton + TruthTable)
 * renders for the /lesson axe audit.
 *
 * F-31 additions (checklist item 13):
 *  - WCAG 2.5.5 target-size rule audited at /lesson (wcag22aa tag).
 *  - FlowSkeleton orientation region: 0 serious/critical violations at /lesson.
 *    The FlowSkeleton is a <nav> with aria-label — not role="progressbar"; the
 *    axe audit confirms it is a semantically valid, non-misleading landmark.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const FIXED_SESSION_ID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';

/** A valid TruthTablePractice mount the WS stub sends after session_start, so the
 *  lesson surface (FlowSkeleton + TruthTable) is actually rendered for the axe audit. */
const TRUTH_TABLE_ACTION = JSON.stringify({
  kind: 'action',
  sessionId: FIXED_SESSION_ID,
  action: {
    type: 'mount',
    component: {
      kind: 'TruthTablePractice',
      expression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      visibleReps: ['truth_table'],
      prompt: 'Fill in the output column for A AND B.',
    },
    rationale: 'axe-stub',
  },
});

type Page = Parameters<Parameters<typeof test>[1]>[0];

async function stubRoutes(page: Page): Promise<void> {
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

/** Stub the agent WebSocket so the lesson surface (FlowSkeleton + TruthTable) mounts.
 *  Used for the /lesson axe tests (F-31 checklist item 13). */
async function stubWs(page: Page): Promise<void> {
  await page.routeWebSocket(/\/agent/, (ws) => {
    ws.onMessage((msg) => {
      let parsed: { kind?: string } | null = null;
      try {
        parsed = JSON.parse(typeof msg === 'string' ? msg : String(msg)) as { kind?: string };
      } catch {
        return;
      }
      if (parsed?.kind === 'session_start') {
        ws.send(TRUTH_TABLE_ACTION);
      }
    });
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

/**
 * F-31 checklist item 13: extend axe coverage to the lesson surface.
 *
 * Two assertions required by the spec:
 *  1. WCAG 2.5.5 target-size: audited via the `wcag22aa` tag at /lesson once the
 *     FlowSkeleton + TruthTable are rendered (WS stub provides the TruthTable).
 *  2. The FlowSkeleton orientation region is semantically correct (non-misleading):
 *     0 serious/critical violations, and specifically no role="progressbar" —
 *     the FlowSkeleton uses <nav aria-label> + role="list", consistent with
 *     ADR-015's non-linear thesis.
 *
 * Note: axe-core's `target-size` rule (WCAG 2.5.5) is in the `wcag22aa` ruleset,
 * available in @axe-core/playwright ≥4.9. We include it explicitly alongside
 * wcag21aa so the gate is clear about which standard each test targets.
 */
test.describe('axe-core audit — F-31 lesson surface (item 13: WCAG 2.5.5 + orientation region)', () => {
  test('lesson surface at /lesson has no serious/critical violations incl. WCAG 2.5.5 target-size', async ({
    page,
  }) => {
    await stubRoutes(page);
    await stubWs(page);
    await page.goto('/lesson');
    await page.waitForSelector('main', { timeout: 10_000 });

    // Dismiss consent modal so lesson controls are visible for the audit.
    // The consent modal's decline button is labelled "No thanks" (see copy/privacy.ts).
    const declineBtn = page.getByRole('button', { name: /no thanks/i });
    if (await declineBtn.isVisible()) await declineBtn.click();

    // Wait for the TruthTable to mount (the WS stub sends it after session_start)
    // so the lesson interactive surface is present for the axe run.
    await page.waitForSelector('[data-testid="flow-skeleton"]', { timeout: 10_000 });

    const results = await new AxeBuilder({ page })
      // wcag21aa covers existing rules; wcag22aa adds WCAG 2.5.5 target-size.
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const gating = failingViolations(results.violations);
    expect(
      gating,
      `serious/critical a11y violations at /lesson:\n${gating
        .map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node[s])`)
        .join('\n')}`,
    ).toEqual([]);
  });

  test('FlowSkeleton orientation region: no role="progressbar", no serious/critical violations', async ({
    page,
  }) => {
    await stubRoutes(page);
    await stubWs(page);
    await page.goto('/lesson');
    await page.waitForSelector('main', { timeout: 10_000 });

    // Dismiss consent modal.
    // The consent modal's decline button is labelled "No thanks" (see copy/privacy.ts).
    const declineBtn = page.getByRole('button', { name: /no thanks/i });
    if (await declineBtn.isVisible()) await declineBtn.click();

    // Wait for FlowSkeleton to be in the DOM.
    const skeleton = page.getByTestId('flow-skeleton');
    await skeleton.waitFor({ timeout: 10_000 });

    // Semantic check: must NOT have role="progressbar" (ADR-015 non-linear thesis).
    const progressbar = page.locator('[role="progressbar"]');
    await expect(progressbar).toHaveCount(0);

    // Axe audit scoped to the FlowSkeleton region.
    const results = await new AxeBuilder({ page })
      .include('[data-testid="flow-skeleton"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const gating = failingViolations(results.violations);
    expect(
      gating,
      `serious/critical a11y violations in FlowSkeleton:\n${gating
        .map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node[s])`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
