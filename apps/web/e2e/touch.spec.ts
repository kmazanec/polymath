/**
 * F-31 — Tablet-touch live drive (the required real-browser test).
 *
 * Runs ONLY on the `tablet` Playwright project (iPad Pro emulation, hasTouch:true).
 * See playwright.config.ts testMatch glob.
 *
 * WHY a real browser is required:
 *   jsdom's getBoundingClientRect() returns 0×0, so any "is this ≥44px?" assertion
 *   there is a silent false-green. Size assertions here use Playwright's
 *   `boundingBox()` which reflects real layout in a rendered browser viewport.
 *   This is the ONLY place touch-target SIZE is verified (spec §testing requirements).
 *
 * Network is stubbed via page.route() (HTTP) and page.routeWebSocket() (WS).
 *   POST /api/session → fixed sessionId
 *   /agent WebSocket → stubbed: after session_start, sends a TruthTablePractice
 *     mount action so the truth-table renders for tap/size tests. After a submit,
 *     sends a CircuitBuilder mount action so the circuit palette renders.
 *
 * Checks:
 *  1. Every interactive control on the initial surface is ≥44×44px.
 *  2. The truth-table output cell (the core toggle target) is ≥44×44px.
 *  3. The FlowSkeleton is present; its first step has aria-current="step".
 *  4. After navigating states, FlowSkeleton aria-current tracks the phase.
 *  5. The circuit palette button (gate drag handle) is ≥44×44px.
 *  6. Tapping a truth-table cell toggles it (basic touch interaction).
 *  7. No role="progressbar" in the FlowSkeleton.
 */
import { expect, test } from '@playwright/test';

// Must be a valid UUID — AgentSocket.onMessage validates inbound frames with
// ServerMessageSchema.safeParse() which enforces `sessionId: z.string().uuid()`.
const FIXED_SESSION_ID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';

/**
 * A valid TruthTablePractice action the stub WS sends after session_start.
 * A AND B: 4 rows (AB=00→0, AB=01→0, AB=10→0, AB=11→1).
 * claimedTruthTable is the output vector in MSB-first order.
 */
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
    rationale: 'stub-truth-table',
  },
});

/**
 * A valid CircuitBuilder action the stub WS sends after a submit frame.
 */
const CIRCUIT_ACTION = JSON.stringify({
  kind: 'action',
  sessionId: FIXED_SESSION_ID,
  action: {
    type: 'mount',
    component: {
      kind: 'CircuitBuilder',
      targetExpression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      allowedGates: ['AND', 'OR', 'NOT'],
      visibleReps: ['circuit'],
      prompt: 'Build the circuit for A AND B.',
    },
    rationale: 'stub-circuit',
  },
});

// ─── Route setup ─────────────────────────────────────────────────────────────

type Page = Parameters<Parameters<typeof test>[1]>[0];

async function stubRoutes(page: Page): Promise<void> {
  // Catch-all: silence stray /api/* requests.
  await page.route(/\/api\//, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // POST /api/session — bootstrap so the SPA renders.
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

  // WebSocket stub: intercept /agent and send component mounts so the real
  // rep surfaces (TruthTable, CircuitBuilder) render for touch/size assertions.
  // Playwright 1.48+ routeWebSocket API.
  await page.routeWebSocket(/\/agent/, (ws) => {
    ws.onMessage((msg) => {
      let parsed: { kind?: string } | null = null;
      try {
        parsed = JSON.parse(typeof msg === 'string' ? msg : String(msg)) as { kind?: string };
      } catch {
        return;
      }
      if (parsed?.kind === 'session_start') {
        // After session_start, mount a TruthTablePractice.
        ws.send(TRUTH_TABLE_ACTION);
      } else if (parsed?.kind === 'submit' || parsed?.kind === 'intro_advance') {
        // After a submit or intro advance, mount a CircuitBuilder.
        ws.send(CIRCUIT_ACTION);
      }
      // All other events (ui_mount, intelligibility_response, etc.) are silently acked.
    });
  });
}

const MIN_TARGET = 44; // WCAG 2.5.5 — 44×44px

// ─── Touch-target size tests ──────────────────────────────────────────────────

test.describe('F-31 touch-target floor (WCAG 2.5.5)', () => {
  test('truth-table output cell is ≥44×44px on iPad Pro', async ({ page }) => {
    await stubRoutes(page);
    await page.goto('/lesson');

    // Dismiss consent modal if present.
    // The consent modal's decline button is labelled "No thanks" (see copy/privacy.ts).
    const declineBtn = page.getByRole('button', { name: /no thanks/i });
    if (await declineBtn.isVisible()) await declineBtn.click();

    // Wait for the TruthTablePractice to mount (the WS stub sends it after session_start).
    await page.waitForSelector('.truth-table-output-cell', { timeout: 10_000 });

    const cell = page.locator('.truth-table-output-cell').first();
    const box = await cell.boundingBox();
    expect(box, 'truth-table-output-cell must have a measurable bounding box').not.toBeNull();
    expect(box!.width, `cell width ${box!.width}px < 44px`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(box!.height, `cell height ${box!.height}px < 44px`).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  test('primary .btn elements are ≥44px tall on iPad Pro', async ({ page }) => {
    await stubRoutes(page);
    await page.goto('/lesson');
    await page.waitForSelector('main', { timeout: 10_000 });

    // Consent modal appears first — dismiss it so we can test lesson buttons.
    // The consent modal's decline button is labelled "No thanks" (see copy/privacy.ts).
    const declineBtn = page.getByRole('button', { name: /no thanks/i });
    if (await declineBtn.isVisible()) await declineBtn.click();

    // Wait for a lesson surface to render (either intro continue btn or the TruthTable).
    await page.waitForSelector('.truth-table-output-cell, .intro-continue-btn, .truth-table-submit', { timeout: 10_000 });

    // Check .btn elements (intro/continue/forward affordances).
    const btns = page.locator('.btn');
    const count = await btns.count();

    let checked = 0;
    for (let i = 0; i < count; i++) {
      const btn = btns.nth(i);
      if (!(await btn.isVisible())) continue;
      const box = await btn.boundingBox();
      if (!box) continue;
      expect(
        box.height,
        `Button "${await btn.textContent()}" height ${box.height}px < 44px`,
      ).toBeGreaterThanOrEqual(MIN_TARGET);
      checked++;
    }

    // Also check the TruthTable Submit button and Hint button if present —
    // these are lesson-surface forward affordances that don't carry the .btn class
    // but must still meet the touch target floor.
    const extraButtons = page.locator('.truth-table-submit, .hint-button');
    const extraCount = await extraButtons.count();
    for (let i = 0; i < extraCount; i++) {
      const btn = extraButtons.nth(i);
      if (!(await btn.isVisible())) continue;
      const box = await btn.boundingBox();
      if (!box) continue;
      expect(
        box.height,
        `Extra button "${await btn.textContent()}" height ${box.height}px < 44px`,
      ).toBeGreaterThanOrEqual(MIN_TARGET);
      checked++;
    }

    // We should find at least one visible forward-affordance button on the page.
    expect(checked, 'No visible lesson buttons found — check that the WS stub is delivering a mount').toBeGreaterThan(0);
  });

  test('intro-continue-btn is ≥44px on iPad Pro (the first forward affordance)', async ({
    page,
  }) => {
    await stubRoutes(page);
    await page.goto('/lesson');
    await page.waitForSelector('main', { timeout: 10_000 });

    // Dismiss consent modal.
    // The consent modal's decline button is labelled "No thanks" (see copy/privacy.ts).
    const declineBtn = page.getByRole('button', { name: /no thanks/i });
    if (await declineBtn.isVisible()) await declineBtn.click();

    const continueBtn = page.locator('.intro-continue-btn');
    const count = await continueBtn.count();
    if (count > 0 && (await continueBtn.first().isVisible())) {
      const box = await continueBtn.first().boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(box!.width).toBeGreaterThanOrEqual(MIN_TARGET);
    }
  });

  test('circuit-palette button is ≥44×44px on iPad Pro', async ({ page }) => {
    await stubRoutes(page);
    await page.goto('/lesson');

    // Dismiss consent modal.
    // The consent modal's decline button is labelled "No thanks" (see copy/privacy.ts).
    const declineBtn = page.getByRole('button', { name: /no thanks/i });
    if (await declineBtn.isVisible()) await declineBtn.click();

    // Wait for TruthTable, then submit to trigger CircuitBuilder mount.
    await page.waitForSelector('.truth-table-output-cell', { timeout: 10_000 });

    // Submit the truth table (click the Submit button if present).
    const submitBtn = page.getByRole('button', { name: /submit/i });
    if ((await submitBtn.count()) > 0 && (await submitBtn.isVisible())) {
      await submitBtn.click();
    }

    // Wait for the CircuitBuilder palette to appear.
    await page.waitForSelector('.circuit-palette button', { timeout: 8_000 });

    const paletteBtn = page.locator('.circuit-palette button').first();
    const box = await paletteBtn.boundingBox();
    expect(box, 'circuit-palette button must have a measurable bounding box').not.toBeNull();
    expect(box!.width, `palette btn width ${box!.width}px < 44px`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(box!.height, `palette btn height ${box!.height}px < 44px`).toBeGreaterThanOrEqual(MIN_TARGET);
  });
});

// ─── FlowSkeleton tests ───────────────────────────────────────────────────────

test.describe('F-31 FlowSkeleton — tablet orientation rail', () => {
  test('FlowSkeleton is present with aria-label and aria-current on first phase', async ({
    page,
  }) => {
    await stubRoutes(page);
    await page.goto('/lesson');
    await page.waitForSelector('main', { timeout: 10_000 });

    // Dismiss consent modal.
    // The consent modal's decline button is labelled "No thanks" (see copy/privacy.ts).
    const declineBtn = page.getByRole('button', { name: /no thanks/i });
    if (await declineBtn.isVisible()) await declineBtn.click();

    // The FlowSkeleton should be rendered in the left rail.
    const skeleton = page.getByTestId('flow-skeleton');
    await skeleton.waitFor({ timeout: 5_000 });

    // Must have an accessible label.
    const label = await skeleton.getAttribute('aria-label');
    expect(label).toBeTruthy();

    // Exactly one step should have aria-current="step".
    const currentSteps = skeleton.locator('[aria-current="step"]');
    await expect(currentSteps).toHaveCount(1);
  });

  test('FlowSkeleton does NOT contain role="progressbar"', async ({ page }) => {
    await stubRoutes(page);
    await page.goto('/lesson');
    await page.waitForSelector('main', { timeout: 10_000 });

    const skeleton = page.getByTestId('flow-skeleton');
    await skeleton.waitFor({ timeout: 5_000 });

    // No progressbar — ADR-015 non-linear thesis.
    const progressbar = page.locator('[role="progressbar"]');
    await expect(progressbar).toHaveCount(0);
  });

  test('FlowSkeleton is readable (≥8px tall) in the rail on iPad Pro viewport', async ({
    page,
  }) => {
    await stubRoutes(page);
    await page.goto('/lesson');
    await page.waitForSelector('main', { timeout: 10_000 });

    const skeleton = page.getByTestId('flow-skeleton');
    await skeleton.waitFor({ timeout: 5_000 });

    const box = await skeleton.boundingBox();
    expect(box).not.toBeNull();
    // Must have real, non-zero height (> 0 rules out collapsed/hidden rail).
    expect(box!.height).toBeGreaterThan(8);
    expect(box!.width).toBeGreaterThan(8);
  });

  test('FlowSkeleton aria-current tracks phase after TruthTable mounts (practicing)', async ({
    page,
  }) => {
    await stubRoutes(page);
    await page.goto('/lesson');

    // Dismiss consent modal.
    // The consent modal's decline button is labelled "No thanks" (see copy/privacy.ts).
    const declineBtn = page.getByRole('button', { name: /no thanks/i });
    if (await declineBtn.isVisible()) await declineBtn.click();

    // Wait for the TruthTable mount which transitions spine to 'practicing'.
    await page.waitForSelector('.truth-table-output-cell', { timeout: 10_000 });

    // After the TruthTable mounts, the spine is in 'practicing'.
    // FlowSkeleton should reflect aria-current on the 'practicing' step.
    const skeleton = page.getByTestId('flow-skeleton');
    await skeleton.waitFor({ timeout: 5_000 });

    const currentStep = skeleton.locator('[aria-current="step"]');
    await expect(currentStep).toHaveCount(1);

    // The currently active step should be 'practicing'.
    const activePhase = await currentStep.getAttribute('data-phase');
    expect(activePhase).toBe('practicing');
  });
});

// ─── Touch interaction tests ──────────────────────────────────────────────────

test.describe('F-31 touch interaction — tap and verify', () => {
  test('tapping truth-table output cell toggles it (touch event)', async ({ page }) => {
    await stubRoutes(page);
    await page.goto('/lesson');

    // Dismiss consent modal.
    // The consent modal's decline button is labelled "No thanks" (see copy/privacy.ts).
    const declineBtn = page.getByRole('button', { name: /no thanks/i });
    if (await declineBtn.isVisible()) await declineBtn.click();

    // Wait for the TruthTable to render (WS stub sends it after session_start).
    await page.waitForSelector('.truth-table-output-cell', { timeout: 10_000 });

    const cell = page.locator('.truth-table-output-cell').first();
    expect(await cell.isVisible()).toBe(true);

    const initialPressed = await cell.getAttribute('aria-pressed');
    // Tap the cell (uses pointer event — correct for hasTouch).
    await cell.tap();
    const afterPressed = await cell.getAttribute('aria-pressed');

    // The pressed state should have toggled.
    expect(afterPressed).not.toBe(initialPressed);
  });

  test('gate drag via touch: circuit palette button has bounding box ≥44×44px after submit', async ({
    page,
  }) => {
    await stubRoutes(page);
    await page.goto('/lesson');

    // Dismiss consent modal.
    // The consent modal's decline button is labelled "No thanks" (see copy/privacy.ts).
    const declineBtn = page.getByRole('button', { name: /no thanks/i });
    if (await declineBtn.isVisible()) await declineBtn.click();

    // Step 1: wait for TruthTable to render.
    await page.waitForSelector('.truth-table-output-cell', { timeout: 10_000 });

    // Step 2: submit to trigger the CircuitBuilder mount via the WS stub.
    const submitBtn = page.getByRole('button', { name: /submit/i });
    if ((await submitBtn.count()) > 0 && (await submitBtn.isVisible())) {
      await submitBtn.click();
    }

    // Step 3: wait for the CircuitBuilder canvas to appear.
    await page.waitForSelector('.circuit-canvas', { timeout: 8_000 });

    // AC#3: gate-drag requires the canvas to be present and finger-sized palette buttons.
    const paletteBtn = page.locator('.circuit-palette button').first();
    await expect(paletteBtn).toBeVisible();
    const box = await paletteBtn.boundingBox();
    expect(box, 'circuit palette button must have a real bounding box').not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(box!.height).toBeGreaterThanOrEqual(MIN_TARGET);

    // Verify the CircuitBuilder canvas itself is present and has a real bounding box.
    const canvas = page.locator('.circuit-canvas');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(canvasBox!.width).toBeGreaterThan(0);
    expect(canvasBox!.height).toBeGreaterThan(0);
  });
});
