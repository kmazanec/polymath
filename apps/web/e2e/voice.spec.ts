/**
 * Desktop Chromium e2e — voice affordance (AskTutorButton)
 *
 * What this spec covers
 * ----------------------
 * These tests drive the real React/Vite app against STUBBED network endpoints.
 * No real LiveKit rooms, no real OpenAI Realtime keys, no real agent backend.
 * The goal is to verify the browser-side voice affordance contract:
 *
 *   1. On page load the mic is NOT requested and /api/realtime/session is NOT
 *      called (permission is deferred until user gesture).
 *   2. Only AFTER the user clicks "Ask the tutor" does the client POST to
 *      /api/realtime/session (token mint round-trip fires on click).
 *   3. After the click the button leaves its idle label — the client progresses
 *      through at least the requesting-permission state before moving on.
 *
 * Deferred-live gap
 * -----------------
 * The real livekit-client Room.connect() is NOT stubbed here. After minting the
 * fake token the VoiceClient calls its default connector which dynamic-imports
 * livekit-client and calls room.connect('wss://fake.livekit', 'faketoken').
 * That WebRTC connection will fail (no real LiveKit cloud), so the button's
 * final state will be 'error' rather than 'connected'. This is intentional and
 * documented: the e2e validates the token round-trip and the permission-deferral
 * contract; the full WebRTC join against a live room is deferred to the manual
 * cross-platform smoke checklist (docs/voice-cross-platform-smoke.md) which
 * requires real LIVEKIT_URL/KEY/SECRET credentials.
 *
 * Stub strategy
 * -------------
 * POST /api/session      — returns a fixed sessionId so the App renders the button.
 * POST /api/realtime/session — returns a 201 fake token payload; we track whether
 *                           this route was called using a flag set in the handler.
 * GET  /api/*            — any other API call returns 200 {} to silence errors.
 * WebSocket /agent       — not interceptable via page.route(); the app will log a
 *                           WS error but remains functional enough for our asserts
 *                           because the AskTutorButton renders as soon as sessionId
 *                           is set in state (independent of the WS connection state).
 *
 * Fake mic
 * --------
 * playwright.config.ts sets use.permissions: ['microphone'] and launch args
 * --use-fake-device-for-media-stream --use-fake-ui-for-media-stream so
 * getUserMedia({audio:true}) auto-grants a silent fake stream — no OS dialog,
 * no real microphone required.
 */

import { expect, test } from '@playwright/test';

const FIXED_SESSION_ID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';
const FAKE_TOKEN_RESPONSE = {
  token: 'faketoken.eyJhbGciOiJIUzI1NiJ9.fake',
  url: 'wss://fake.livekit.example',
  roomName: `session-${FIXED_SESSION_ID}`,
  // expiresAt 5 min in the future (ms epoch); use a far-future value so the
  // TokenRefresher doesn't fire immediately and add noise.
  expiresAt: Date.now() + 300_000,
};

test.describe('AskTutorButton — voice affordance', () => {
  /**
   * Shared route setup: stub the session bootstrap and voice-token endpoints.
   * Returns a boolean tracker ref for whether the realtime/session route fired.
   */
  async function stubRoutes(page: Parameters<Parameters<typeof test>[1]>[0]) {
    let realtimeSessionCalled = false;

    // Playwright matches routes in LIFO (last-registered-first) order.
    // Register the catch-all FIRST so more-specific rules registered after it
    // take precedence and handle their own paths before the catch-all fires.

    // 3. Catch-all for any remaining /api/* calls — return empty 200 so the app
    //    doesn't surface unrelated network errors that could mask our assertions.
    //    Registered first so it has the lowest priority (LIFO).
    await page.route(/\/api\//, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // 2. POST /api/realtime/session — voice token mint. 201 per the spec.
    //    Registered second (higher priority than catch-all, lower than /api/session).
    await page.route(/\/api\/realtime\/session/, async (route) => {
      if (route.request().method() === 'POST') {
        realtimeSessionCalled = true;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(FAKE_TOKEN_RESPONSE),
        });
      } else {
        await route.continue();
      }
    });

    // 1. POST /api/session — bootstrap: returns a sessionId so React sets
    //    sessionId in state and renders <AskTutorButton>.
    //    Registered last = highest priority (LIFO). The regex uses a word-boundary
    //    anchor so it matches /api/session but NOT /api/realtime/session.
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

    return {
      wasRealtimeSessionCalled: () => realtimeSessionCalled,
    };
  }

  // ------------------------------------------------------------------ //
  // Test 1 — mic permission deferred: button present, no token call at load
  // ------------------------------------------------------------------ //
  test('does NOT call /api/realtime/session on page load (permission deferred to click)', async ({
    page,
  }) => {
    const tracker = await stubRoutes(page);

    await page.goto('/');

    // Wait for the AskTutorButton to appear — it renders once sessionId is set.
    // The button label is "🎤 Ask the tutor" in idle state.
    await page.waitForSelector('[data-voice-state]', { timeout: 10_000 });

    // Assert: the realtime/session endpoint was NOT hit before any click.
    expect(tracker.wasRealtimeSessionCalled()).toBe(false);

    // Assert: the button is in idle state (not connecting / connecting / error).
    const voiceState = await page.getAttribute('[data-voice-state]', 'data-voice-state');
    expect(voiceState).toBe('idle');
  });

  // ------------------------------------------------------------------ //
  // Test 2 — click triggers the token mint round-trip
  // ------------------------------------------------------------------ //
  test('calls /api/realtime/session after clicking "Ask the tutor"', async ({ page }) => {
    const tracker = await stubRoutes(page);

    await page.goto('/');

    // Wait for the button to appear in idle state.
    await page.waitForSelector('[data-voice-state="idle"]', { timeout: 10_000 });

    // Pre-click guard: token endpoint not yet called.
    expect(tracker.wasRealtimeSessionCalled()).toBe(false);

    // Click the "Ask the tutor" button.
    await page.click('[data-voice-state]');

    // Post-click: give the async flow time to progress (getUserMedia → fetch).
    // We wait for the button to leave the 'idle' state, which confirms the
    // click handler fired and the client started its async start() sequence.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-voice-state]');
        return el !== null && el.getAttribute('data-voice-state') !== 'idle';
      },
      { timeout: 8_000 },
    );

    // Assert: the token endpoint WAS called after the click.
    expect(tracker.wasRealtimeSessionCalled()).toBe(true);

    // Assert: the button label changed from the idle label to something else.
    // Any non-idle state label (Connecting…, Listening…, Voice unavailable, etc.)
    // confirms the affordance responded to the click.
    const voiceState = await page.getAttribute('[data-voice-state]', 'data-voice-state');
    expect(voiceState).not.toBe('idle');
  });

  // ------------------------------------------------------------------ //
  // Test 3 — button is disabled after click (no double-start)
  // ------------------------------------------------------------------ //
  test('button becomes disabled immediately after click', async ({ page }) => {
    await stubRoutes(page);

    await page.goto('/');
    await page.waitForSelector('[data-voice-state="idle"]', { timeout: 10_000 });

    // Click — the client transitions out of 'idle' immediately.
    await page.click('[data-voice-state]');

    // Wait for the state to leave 'idle'.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-voice-state]');
        return el !== null && el.getAttribute('data-voice-state') !== 'idle';
      },
      { timeout: 8_000 },
    );

    // The button should be disabled in all non-idle states (per isDisabled() in
    // AskTutorButton.tsx: disabled when state !== 'idle').
    const isDisabled = await page.$eval('[data-voice-state]', (el) =>
      (el as HTMLButtonElement).disabled,
    );
    expect(isDisabled).toBe(true);
  });
});
