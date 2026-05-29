/**
 * PostHog product-analytics + session-replay wiring for the web client.
 *
 * FAIL CLOSED, CONSENT-GATED, NO-OP BY DEFAULT (the LiveKit env-gate pattern applied
 * client-side):
 *  - `initPostHog` only initializes when BOTH `VITE_POSTHOG_KEY` AND `VITE_POSTHOG_HOST`
 *    are non-empty (a PARTIAL config is treated as not configured) AND the learner has
 *    given `consent`. Until then PostHog is never loaded and `capture()` is a silent
 *    drop — no analytics event leaves the browser, and session replay never starts.
 *  - Session replay is OFF by default (`disable_session_recording: true` at init) and is
 *    started EXPLICITLY only in the consented branch — so replay records only opt-in
 *    experiment subjects (AC#7), never a default learner.
 *  - The analytics group key is the `sessionId` (ADR-006), set via `groupBySession`.
 *
 * `posthog-js` is loaded lazily (dynamic import) only inside the consented branch, so
 * the library is never pulled in for a learner who declines. Tests inject a fake client
 * via `__setPosthogFactoryForTest` so the gating logic is exercised without the network.
 */

/** The minimal slice of the `posthog-js` client surface this module drives. */
interface PostHogClient {
  init: (key: string, config: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  group: (groupType: string, groupKey: string, properties?: Record<string, unknown>) => void;
  startSessionRecording: () => void;
}

/** The LOCKED analytics event names (the convention the counter-metrics dashboard
 *  reads). Adding a name is a coordinated change with the dashboard; the union keeps
 *  call sites honest. */
export type PostHogEventName =
  | 'mount'
  | 'hint_request'
  | 'transfer_probe_entered'
  | 'transfer_probe_exited'
  | 'mastery_declared'
  | 'lesson_transition';

export interface InitPostHogOptions {
  key: string;
  host: string;
  consent: boolean;
}

/** The active client once a consented init succeeds; `null` until then (no-op state). */
let client: PostHogClient | null = null;

/** Test seam: the factory that produces a client. Defaults to the real lazy import. */
let clientFactory: (() => Promise<PostHogClient> | PostHogClient) | null = null;

/** Whether PostHog is initialized and capturing (false in the default no-op state). */
export function isPostHogActive(): boolean {
  return client !== null;
}

/**
 * Initialize PostHog iff fully configured AND consented. A no-op otherwise — the
 * default state of the app. Idempotent: a second consented init is ignored.
 */
export async function initPostHog(opts: InitPostHogOptions): Promise<void> {
  if (client !== null) return; // already active — idempotent
  // FAIL CLOSED: partial config (missing key OR host) or no consent → not configured.
  if (!opts.consent) return;
  if (!opts.key || opts.key.trim() === '') return;
  if (!opts.host || opts.host.trim() === '') return;

  const produced = clientFactory ? clientFactory() : await loadPosthog();
  const ph = produced instanceof Promise ? await produced : produced;

  ph.init(opts.key, {
    api_host: opts.host,
    // Replay is OFF at init; the consented branch below turns it on explicitly. A
    // declined learner never reaches this code, so replay never autostarts for them.
    disable_session_recording: true,
    // Don't capture pageviews/pageleaves automatically — we emit explicit, typed events.
    capture_pageview: false,
    autocapture: false,
  });

  client = ph;

  // Consent was granted (we only get here in that branch): start session replay for the
  // opted-in subject. This is the ONLY place replay is enabled.
  ph.startSessionRecording();
}

/** Lazy-load the real `posthog-js` default export, adapted to `PostHogClient`. */
async function loadPosthog(): Promise<PostHogClient> {
  const mod = await import('posthog-js');
  return mod.default as unknown as PostHogClient;
}

/**
 * Capture a typed analytics event. A silent no-op when PostHog is inactive (declined /
 * unconfigured), so every call site can fire unconditionally and vanish cleanly when
 * analytics are off.
 */
export function capture(event: PostHogEventName, properties?: Record<string, unknown>): void {
  if (client === null) return;
  client.capture(event, properties);
}

/** Associate subsequent events with the session group (ADR-006: group key = sessionId). */
export function groupBySession(sessionId: string): void {
  if (client === null) return;
  client.group('session', sessionId);
}

/** Test seam: inject a fake client factory (bypasses the lazy `posthog-js` import). */
export function __setPosthogFactoryForTest(
  factory: () => Promise<PostHogClient> | PostHogClient,
): void {
  clientFactory = factory;
}

/** Test seam: reset module state between tests. */
export function __resetPostHogForTest(): void {
  client = null;
  clientFactory = null;
}
