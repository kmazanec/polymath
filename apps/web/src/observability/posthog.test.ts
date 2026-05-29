/**
 * PostHog wiring — fail-closed, consent-gated, no-op-by-default.
 *
 * The acceptance criteria ARE this spec:
 *  - `initPostHog` is a NO-OP unless BOTH `VITE_POSTHOG_KEY` AND `VITE_POSTHOG_HOST`
 *    are non-empty (a PARTIAL config = not configured) AND `consent === true`.
 *  - `capture()` before a successful init silently drops (never throws, never queues
 *    into a real client).
 *  - the group key is `sessionId` (ADR-006).
 *  - session replay (`disable_session_recording`) stays OFF until the consented init.
 *
 * We inject a fake posthog client (`__setPosthogFactoryForTest`) so the gating logic
 * is asserted without loading `posthog-js` or touching the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initPostHog,
  capture,
  groupBySession,
  isPostHogActive,
  __setPosthogFactoryForTest,
  __resetPostHogForTest,
} from './posthog.js';

interface FakeClient {
  init: ReturnType<typeof vi.fn>;
  capture: ReturnType<typeof vi.fn>;
  group: ReturnType<typeof vi.fn>;
  startSessionRecording: ReturnType<typeof vi.fn>;
}

function makeFake(): FakeClient {
  return {
    init: vi.fn(),
    capture: vi.fn(),
    group: vi.fn(),
    startSessionRecording: vi.fn(),
  };
}

const KEY = 'phc_test_key';
const HOST = 'https://us.posthog.example';

describe('posthog (consent + config gating)', () => {
  let fake: FakeClient;

  beforeEach(() => {
    fake = makeFake();
    __setPosthogFactoryForTest(() => fake as never);
  });

  afterEach(() => {
    __resetPostHogForTest();
  });

  it('does NOT init when consent is false (even with full config)', async () => {
    await initPostHog({ key: KEY, host: HOST, consent: false });
    expect(fake.init).not.toHaveBeenCalled();
    expect(isPostHogActive()).toBe(false);
  });

  it('does NOT init when the key is missing (partial = not configured)', async () => {
    await initPostHog({ key: '', host: HOST, consent: true });
    expect(fake.init).not.toHaveBeenCalled();
    expect(isPostHogActive()).toBe(false);
  });

  it('does NOT init when the host is missing (partial = not configured)', async () => {
    await initPostHog({ key: KEY, host: '', consent: true });
    expect(fake.init).not.toHaveBeenCalled();
    expect(isPostHogActive()).toBe(false);
  });

  it('inits only when key + host + consent are all present/true', async () => {
    await initPostHog({ key: KEY, host: HOST, consent: true });
    expect(fake.init).toHaveBeenCalledTimes(1);
    expect(isPostHogActive()).toBe(true);
    // The init config keeps session recording OFF at boot — the consented branch turns
    // it on explicitly, never the default autostart.
    const cfg = fake.init.mock.calls[0]![1] as { disable_session_recording?: boolean };
    expect(cfg.disable_session_recording).toBe(true);
  });

  it('starts session replay only after a consented init (off by default)', async () => {
    // Before init: no recording.
    expect(fake.startSessionRecording).not.toHaveBeenCalled();
    await initPostHog({ key: KEY, host: HOST, consent: true });
    // The consented branch explicitly starts recording (replay ON only for opt-in).
    expect(fake.startSessionRecording).toHaveBeenCalledTimes(1);
  });

  it('capture() before init silently drops (no client, no throw)', () => {
    expect(() => capture('mount', { componentKind: 'TruthTable', phase: 'practicing' })).not.toThrow();
    expect(fake.capture).not.toHaveBeenCalled();
  });

  it('capture() after a consented init forwards to the client', async () => {
    await initPostHog({ key: KEY, host: HOST, consent: true });
    capture('mount', { componentKind: 'TruthTable', phase: 'practicing' });
    expect(fake.capture).toHaveBeenCalledWith('mount', {
      componentKind: 'TruthTable',
      phase: 'practicing',
    });
  });

  it('groupBySession uses the sessionId as the group key (ADR-006)', async () => {
    await initPostHog({ key: KEY, host: HOST, consent: true });
    groupBySession('sess-123');
    expect(fake.group).toHaveBeenCalledWith('session', 'sess-123');
  });

  it('groupBySession before init silently drops', () => {
    expect(() => groupBySession('sess-123')).not.toThrow();
    expect(fake.group).not.toHaveBeenCalled();
  });
});
