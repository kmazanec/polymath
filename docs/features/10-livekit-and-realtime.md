# Feature: LiveKit + OpenAI Realtime bridge + ephemeral token endpoint

**ID:** F-10 · **Iteration:** I2 — Voice + full mastery gate · **Status:** Not started

## What this delivers (before → after)

**Before:** No voice. The microphone permission is never requested. The audio-native anti-cheat thesis from [ADR-004](../adrs/ADR-004-modalities-and-sensors.md) is unproven. No room exists between browser, LiveKit, and OpenAI Realtime.

**After:** A new REST endpoint `POST /api/realtime/session` mints a short-lived LiveKit ephemeral token. The browser, on first voice use (deferred from session start per [ADR-004](../adrs/ADR-004-modalities-and-sensors.md)), requests the microphone permission, calls the endpoint, and joins a LiveKit room. The agent service runs a LiveKit Agents bridge that proxies the room to OpenAI Realtime (`gpt-realtime`). A round-trip smoke test ("say hello, transcribe back, and the transcript appears in the session events table") works against the deployed URL on Chrome, Firefox, and iOS Safari.

System prompt + tutor persona + current lesson state are cached at session start; cache hit rate measurable via OTel. Barge-in (interruption) works: speaking while the model is responding causes the model to stop.

## How it fits the roadmap

I2, **on the critical path**. F-11 (explain-back rubric) depends on F-10 — the rubric consumes transcripts and the LiveKit room is where they come from.

## Dependencies (must exist before this starts)

- **F-05** — agent service exists; provider abstraction is wired (it manages the structured-output calls; F-10 manages the realtime audio call separately).

External: LiveKit Cloud account (API key + secret + URL); LiveKit Agents SDK (Node); OpenAI Realtime API access (already in `.env`).

## Unblocks (what waits on this)

- **F-11** — explain-back rubric needs a transcript source.
- **F-19** — accessibility audit covers the microphone permission UX.
- **F-20** — OTel voice-loop traces.

## Contracts touched

- **REST API** — adds `POST /api/realtime/session`. Append-only.
- **WebSocket protocol** — no change. Voice flows over WebRTC, not the existing WebSocket.
- **`learner_state`** — no schema change; per-turn transcripts are stored in `events` (already JSONB).
- **`events` table** — gains a new `eventKind: 'voice_turn'` with payload including transcript, prosody features, model_version, cache_hit, ttft_ms, barge_in. Append-only.
- **LiveKit Agents bridge** — `apps/agent/src/voice/bridge.ts`. Lives in the agent service container.
- **System prompt + tutor persona** — `apps/agent/src/voice/persona.ts`. The cache-friendly system prompt construction. Locked here; F-11 reads from this.
- **OTel attributes per voice turn** — schema introduced here per [ADR-006](../adrs/ADR-006-voice-and-agent-llm-stack.md).

## Sub-tasks

1. **T-10a — Ephemeral token endpoint** `[parallel]`
   - `POST /api/realtime/session` mints LiveKit token with grants scoped to a single room.
   - Token lifetime: 5 minutes.
2. **T-10b — Browser-side voice client** `[parallel]`
   - `apps/web/src/voice/client.ts` — joins the room, captures mic, plays back any audio response.
   - Microphone permission requested on first voice use (button click on `ExplainBackPrompt` or `Ask the tutor` affordance), not session start.
3. **T-10c — LiveKit Agents bridge in `apps/agent`** `[parallel]`
   - `apps/agent/src/voice/bridge.ts` — joins the room as the agent participant, proxies audio to/from OpenAI Realtime.
   - Server-side VAD for barge-in handling.
4. **T-10d — Cache-friendly system prompt construction** `[parallel]`
   - System prompt + tutor persona + current lesson state assembled at session start; passed once; subsequent turns reuse cache.
   - Verify cache hit rate via OTel attribute in T-10g.
5. **T-10e — Per-turn transcript + prosody event logging** `[parallel after T-10c]`
6. **T-10f — Caddy WebRTC path-through verification** `[parallel]`
   - LiveKit traffic is direct browser ↔ LiveKit Cloud (not via Caddy), but the token-mint endpoint goes via Caddy. Verify no proxy issues.
7. **T-10g — OTel attributes per turn** `[parallel after T-10c]`
8. **T-10h — Cross-platform smoke tests** `[parallel after T-10b, T-10c]`
   - Chrome desktop, Firefox desktop, Safari desktop, Chrome Android, Safari iOS. Manual but scripted.

## Acceptance criteria (product behavior)

1. **A learner clicking the `Ask the tutor` button** is prompted for microphone permission (only on first click in the session); after granting, they can say "hello" and receive an audible response from the model within ~1 second TTFT.
2. **The transcript of the learner's utterance** appears in the `events` table within ~2 seconds of the utterance ending.
3. **Barge-in works**: while the model is speaking a response, the learner interrupting (speaking over) causes the model audio to stop within ~300ms.
4. **The cross-platform smoke test passes on**: Chrome desktop, Firefox desktop, Safari desktop, Chrome Android, Safari iOS. Failures on any platform are documented in the limitations memo, not blocked.
5. **Cache hit rate** is observable via OTel and matches the documented 3–5× cost ratio after session warmup.
6. **The microphone permission is NOT requested at session start** — verified by opening a fresh session in an incognito window and observing no permission prompt until the first voice affordance is clicked.
7. **OTel trace per voice turn** includes `turn_id`, `learner_id`, `lesson_id`, `phase`, `model_version`, `cache_hit`, `ttft_ms`, `barge_in`, `transcript_log_id`.
8. **Ephemeral token expires after 5 minutes**; a long session that crosses 5 minutes is verified to refresh tokens transparently.

## Testing requirements

- Integration test (Node): mint a token, join a LiveKit room from the test harness, send a synthetic audio frame, assert a transcript comes back.
- E2E browser test (Playwright): click `Ask the tutor`, mock the mic (Playwright's `--use-fake-device-for-media-stream`), assert a transcript appears.
- Manual cross-platform smoke (T-10h) — scripted per the Round 3 cross-platform matrix from [ADR-006](../adrs/ADR-006-voice-and-agent-llm-stack.md).
- OTel assertion: every voice turn emits a trace with all required attributes.

## Manual setup required

- LiveKit Cloud account + project + API key + URL — provisioned in F-01's `.env`, just confirm.
- OpenAI Realtime API access on the existing key — confirm.
- Browser permission testing requires manual interaction; can't fully automate.
- Cross-platform smoke (T-10h) is half a day of manual testing.

## Convergence and expected rework

None within I2 — F-11 and F-12 are downstream of F-10 and don't run concurrent.

⚠ **iOS Safari quirks** are a known risk per [ADR-006](../adrs/ADR-006-voice-and-agent-llm-stack.md). If smoke-test fails on iOS, the fix is documented + scoped here, not in F-11.

## Implementation plan (approved 2026-05-28)

**Approach decisions (resolved with the user before build):**
- **Mocked LiveKit/OpenAI-Realtime boundary.** The network boundary is behind an injectable
  interface so the suite runs without secrets. The repo has no `.env` and blank LiveKit/OpenAI
  keys, so the **live** round-trip + cross-platform device smoke are deferred to the user
  (need real LiveKit Cloud keys + OpenAI Realtime access + physical devices).
- **OTel attributes via `@opentelemetry/api` + a no-op/in-memory exporter.** F-10 owns the
  voice-turn span *schema*; F-20 wires real exporters.
- **Cross-platform (criterion 4) = scripted manual checklist + a desktop-Chromium Playwright
  e2e.** Device-matrix boxes stay unchecked with an explicit "requires your devices" note.

**Contract scope correction:** `packages/contract` wire union is NOT touched — voice flows over
WebRTC; `voice_turn` is a value in the `events.kind` text column, not a new wire variant. The one
cross-cutting touchpoint is the new REST route `POST /api/realtime/session` (append-only). No DB
migration (`events.payload` is already JSONB).

Critical path inside F-10: the realtime boundary interface (C2) locks first; the rest run parallel
against the frozen interface.

- [x] **C1 — Ephemeral token endpoint** (T-10a) — `voice/token.ts` mints a room-scoped LiveKit
  token, 5-min TTL; wired as `POST /api/realtime/session`, validates session exists. → criterion 8.
- [x] **C2 — Realtime boundary interface + cache-friendly persona** (T-10c seam, T-10d) —
  `voice/realtimeClient.ts` (`RealtimeSession` interface + `MockRealtimeSession`) + `voice/persona.ts`
  (cache-friendly system prompt, stable cache key). → criterion 5.
- [x] **C3 — LiveKit Agents bridge** (T-10c) — `voice/bridge.ts` joins room as agent participant,
  proxies audio to/from `RealtimeSession`, handles barge-in (interrupt on learner audio). → criterion 3.
- [x] **C4 — voice_turn event + OTel attrs** (T-10e, T-10g) — `voice/voiceTurn.ts` (Zod payload) +
  `voice/otel.ts` (span with the 8 required attrs, no-op exporter); bridge persists each turn. →
  criteria 2, 7.
- [x] **C5 — Browser voice client + Ask-the-tutor affordance** (T-10b) — `apps/web/src/voice/client.ts`
  + `AskTutorButton` requesting mic permission on click only, calling the token endpoint. →
  criteria 1, 6.
- [x] **C6 — Token refresh across the 5-min boundary** (T-10a/b) — transparent re-mint before
  expiry. → criterion 8 (refresh).
- [x] **C7 — Playwright desktop e2e + cross-platform checklist + Caddy note** (T-10h, T-10f) —
  Playwright (fake media device) asserts the permission-defer + token-mint contract;
  `docs/voice-cross-platform-smoke.md` scripted per ADR-006; confirmed token endpoint passes through
  Caddy (`/api/*` already routes to the agent). → criterion 4 (desktop Chromium only).
- [x] **Review (Step 6)** — Wave 1 spec+security, Wave 2 robustness+efficiency; high/medium fixed.
- [x] **Smoke (Step 7)** — drive the running app end-to-end against the live proxied agent + regression.

**Deferred (unchecked, requires user keys/devices):** criteria 1/2/3/5 *live*, 8 *live refresh*,
4 *device matrix*. Mocked-boundary tests cover the contract.

## Implementation notes (filled in by the building agent)

### C1 — Ephemeral token endpoint
`apps/agent/src/voice/token.ts` exports `mintRealtimeToken({sessionId, apiKey, apiSecret, livekitUrl, now?})`
→ `{token, url, roomName, expiresAt}`, `roomNameForSession(id)='session-<id>'`, `REALTIME_TOKEN_TTL_SECONDS=300`.
Route `POST /api/realtime/session` in `server.ts`: 201 (valid session), 404 (unknown), 400 (bad/non-uuid body),
413 (>16KB body), 503 (LiveKit keys unset — graceful "voice not configured", since the repo ships no keys).
Grant is room-scoped (`roomJoin`, `room`, `canPublish`, `canSubscribe`) — **no admin/list/create grant** (least
privilege; the browser gets a token that can only join its own session room). Participant identity is
`learner-<sessionId>-<uuid>` so repeat mints don't collide/kick.

**Verified against the running system** (agent booted on :8099 against the test Postgres, dummy LiveKit creds):
```
POST /api/realtime/session {sessionId:<valid>}  -> HTTP/1.1 201 Created
  decoded JWT grant: {roomJoin:true, room:"session-<id>", canPublish:true, canSubscribe:true}, exp-nbf=300s, no admin
POST /api/realtime/session {sessionId:<unknown-uuid>} -> 404
POST /api/realtime/session {} -> 400
```
Tests: `src/voice/token.test.ts` 5 passed (no DB); `src/server.integration.test.ts` 13 passed (4 new, DB-backed).

### C2 — Realtime boundary interface + persona (the frozen seam)
`apps/agent/src/voice/realtimeClient.ts` defines `RealtimeSession` (connect / sendAudioFrame / onTranscript /
onAudio / interrupt / isResponding / close / readonly cacheHit), `VoiceTranscript {role, text, at, final}`,
`RealtimeSessionConfig {systemPrompt, cacheKey, model}`, and `MockRealtimeSession` (deterministic, no timers:
`pushLearnerUtterance` + `tick()`/`flush()`; `interrupt()` drops the unemitted queue and clears `isResponding`;
`cacheHit` warms on the 2nd connect with the same key via a module registry — `resetCacheRegistry()` per test).
`apps/agent/src/voice/persona.ts`: `VOICE_PERSONA` (byte-identical stable prefix), `buildVoiceSystemPrompt(input)`
(prefix + small volatile tail), `voiceCacheKey({lessonId, phase})='lesson:<id>|phase:<phase>'`. Cache-friendly =
large stable persona first (cacheable prefix), volatile lesson context last.
Tests: `realtimeClient.test.ts` 10 + `persona.test.ts` 9 = 19 passed (pure, no DB).

> Downstream chunks (C3 bridge, C4 event/OTel) consume the **frozen** `RealtimeSession` above — do not reshape it.

### C4 — voice_turn event + OTel attributes
`apps/agent/src/voice/voiceTurn.ts`: `VoiceTurnPayload` Zod schema `{turnId, transcript:{learner?,tutor?}, prosody?,
modelVersion, cacheHit, ttftMs, bargeIn, transcriptLogId}`; `logVoiceTurn(db, sessionId, payload)` inserts a
`kind:'voice_turn'` events row and returns `{transcriptLogId}` = the row uuid (no migration — `events.payload` is
already JSONB). `apps/agent/src/voice/otel.ts`: `recordVoiceTurnSpan(attrs)` emits span `voice.turn` via
`trace.getTracer('polymath.voice')` carrying exactly the 9 required attrs (`turn_id, learner_id, lesson_id, phase,
model_version, cache_hit, ttft_ms, barge_in, transcript_log_id`). No provider registered in prod code → the OTel API
no-ops until F-20 wires exporters; the test registers an `InMemorySpanExporter` to assert the attrs.
Tests: `voiceTurn.test.ts` 1 (DB) + `otel.test.ts` 1 = green.

### C3 — LiveKit Agents bridge
`apps/agent/src/voice/bridge.ts` — `VoiceBridge` wires an injected `RealtimeSession` (mocked in tests, LiveKit-backed
in prod) to the room: `start()` builds the persona, connects, subscribes to transcript/audio, forwards tutor audio via
an injected `publishAudio`; `onLearnerAudioActivity()` is the VAD hook — if `isResponding()`, it sets `bargeIn:true`,
calls `interrupt()` (drops the unemitted tutor queue → no further frames) and finalizes the turn; `ttftMs` is measured
from the learner-final `at` to the first tutor output (injectable clock). Each completed/barged-in turn is persisted via
`logVoiceTurn` + spanned via `recordVoiceTurnSpan`. No `@livekit/agents` import — the real LiveKit-backed session +
room-publishing callback plug into the same injected surface (deferred to live wiring).
Tests: `bridge.test.ts` 4 (happy path persists a turn; barge-in interrupts + logs `bargeIn:true`; cleanup idempotent).

### C5 — Browser voice client + Ask-the-tutor affordance
`apps/web/src/voice/client.ts` — `VoiceClient.start()` (call on click) requests mic via `getUserMedia` *only here*
(criterion 6), POSTs the token endpoint (503→`unavailable`, graceful), then joins via an injected `RoomConnector`
(default lazy-`import('livekit-client')` so the module loads/tests run without the SDK). `apps/web/src/voice/AskTutorButton.tsx`
— a real `<button>` that calls `start()` on click and reflects state; never calls `getUserMedia` on mount.
Tests: `client.test.ts` 8 + `AskTutorButton.test.tsx` 9 = green (the mount-without-getUserMedia test proves criterion 6).

### C6 — Token refresh across the 5-minute boundary
`apps/web/src/voice/tokenRefresh.ts` — `TokenRefresher.start(expiresAt)` schedules a re-mint at `expiresAt − skew − now`
(skew default 60s, floor 0), then on fire mints → applies → re-schedules off the *new* expiry (rolling, indefinite); a
`mint` failure calls `onError` + retries on a bounded backoff so a transient failure doesn't end refresh while the token
still has ~skew of validity; `stop()` is idempotent. Tests: `tokenRefresh.test.ts` 7 = green (deterministic; injected clock+timer).

### Integration (coordinator)
- Added optional `RoomConnector.updateToken(token)`; `VoiceClient` constructs a `TokenRefresher` after a successful
  connect (only when the connector supports `updateToken`) and `stop()`s it on teardown. The default connector's
  `updateToken` does a fast reconnect with the fresh token (livekit-client has no in-place token swap; refresh fires at
  T−60s, well inside the old token's validity).
- Mounted `<AskTutorButton sessionId={sessionId} />` into `App.tsx` beside the existing text question form (the spoken
  counterpart), gated on a non-null `sessionId`.
- Added `livekit-client` to `apps/web` (runtime dep for the default connector).

**Verification (coordinator-run):** `pnpm typecheck` clean across the workspace; `pnpm --filter @polymath/web build`
succeeds (Vite handles the runtime-assembled dynamic import); full `pnpm test` = **425 passed | 1 skipped** (the 1 skip
is the pre-existing API-key-gated `agent/src/agent/eval/eval.test.ts`, untouched by F-10). Agent voice suite 30 passed,
web voice suite 24 passed.

### C7 — Playwright e2e + cross-platform checklist + Caddy
`apps/web/playwright.config.ts` (desktop Chromium, fake media device, mic pre-granted, Vite webServer on :5173) +
`apps/web/e2e/voice.spec.ts` (3 tests, run via `pnpm --filter @polymath/web e2e`; vitest does not collect `e2e/*` so
the unit count stays 137). The e2e stubs `/api/session` + `/api/realtime/session` with `page.route()` and asserts the
**permission-defer + token-mint contract**: on load the button is `idle` and `/api/realtime/session` is NOT hit; after
click it IS hit and the button leaves idle. **Deferred-live gap documented in the spec:** after the token mint the
default connector dials `wss://fake.livekit` and lands in `error` (no real LiveKit Cloud) — the real WebRTC join + the
audible round-trip are the manual-smoke gap.
`docs/voice-cross-platform-smoke.md`: scripted manual checklist for all 5 ADR-006 platforms (Chrome/Firefox/Safari
desktop + Chrome Android + iOS Safari), Setup (env keys), Known-risks (iOS Safari autoplay/permission), a blank results
table — all boxes UNCHECKED pending a human with devices + real keys. Caddy note: `POST /api/realtime/session` needs no
new route (the existing `handle /api/*` in both caddyfiles covers it); LiveKit WebRTC media is browser↔Cloud direct, only
the token mint traverses Caddy.
Playwright: **3 passed**.

> **Build note:** Vite emits a non-fatal "dynamic import cannot be analyzed" warning for the runtime-assembled
> `livekit-client` specifier in `client.ts`. Intended (the connector is an optional peer the bundle shouldn't statically
> pull); the build + e2e succeed. A future cleanup could add `/* @vite-ignore */` to silence it.

### Deferred — requires the user's LiveKit/OpenAI keys + physical devices
The mocked-boundary tests cover the *contract*; these need real credentials/devices and are **not** checked off:
- **Criteria 1, 2, 3, 5 (live):** audible round-trip ~1s TTFT, transcript in `events` ≤2s, barge-in <300ms, and the
  cache-hit cost ratio can only be observed against real OpenAI Realtime over a real LiveKit room.
- **Criterion 8 (live refresh):** the >5-minute seamless token refresh needs a live long session.
- **Criterion 4 (device matrix):** Chrome/Firefox/Safari desktop + Chrome Android + iOS Safari is human device testing.
  `docs/voice-cross-platform-smoke.md` is the script; run it with keys + devices and tick its table.
Set `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` + confirm OpenAI Realtime access in `.env`, then run the
checklist. The endpoint already returns 503 "voice not configured" until those keys are set.

### Review — Step 6

**Wave 1 (both Opus):**
- *Spec-compliance:* fully compliant. Per-criterion: 6 (mic-on-click) MET + proven (`client.test.ts`, `AskTutorButton.test.tsx`,
  e2e); 7 (9 OTel attrs) MET + asserted (`otel.test.ts`); 8-TTL (300s) MET + asserted (`token.test.ts`); 1/2/3/5 MET at
  the contract level via the mocked boundary with honest live deferrals; 4 desktop-Chromium MET, device matrix scripted+
  deferred. No missed/faked items, **no contract drift** (`packages/contract` untouched; wire union unchanged; the only
  API addition is `POST /api/realtime/session`), no feature-ID-in-source, mastery-gate untouched.
- *Security:* no HIGH. Two MEDIUM + one LOW.
  - **MED-1 — no rate limiting on the mint endpoint (amplification/cost abuse): FIXED.** Added `voice/rateLimiter.ts`
    (fixed-window, per-process) and a 6/min-per-session cap on the route → 429 over the cap. Proven by `rateLimiter.test.ts`
    (4) + an integration 429 test. The legitimate client mints ~once/4min, so the cap is far above real use.
  - **MED-2 — sessionId is the only capability; no owner binding (audio-eavesdrop escalation if a sessionId leaks):
    RECORDED, not fixed here.** This is a *pre-existing app-wide property* (the whole WS protocol treats the sessionId as
    the bearer capability) — fixing it means adding auth + a `learnerId` across the app, which is out of F-10's scope and
    would be contract drift. F-10 does not weaken it; it does *raise the stakes* (a leaked sessionId now also exposes live
    audio). Captured in the Retro + propagated to ROADMAP for the auth iteration. Until auth lands: sessionIds over TLS only,
    never logged.
  - **LOW — refresh-skew margin:** clean, no action (refresh at T−60s uses the still-valid old token; bounded retry).
  Confirmed clean: secret stays server-side, least-privilege room-scoped token, session-existence check (not an open oracle),
  16KB body cap + UUID validation, Zod-validated parameterized `voice_turn` insert, mic only on gesture + tracks stopped on
  teardown, CSWSH/CORS posture unchanged.

**Wave 2 (both Sonnet); triage on Opus:**
- *Robustness:* no HIGH. **Fixed:** **M-1** bridge `handleTranscript`/`handleAudio` now guard on `stopped` (a real
  provider's WS drains async — no post-close DB insert); **M-2** a late final tutor transcript after a barge-in no longer
  logs a phantom empty turn (`turnHasContent()` guard); **M-3** `VoiceClient.stop()` during an in-flight `start()` now
  aborts at checkpoints (`_abortStart()`) so it ends `idle`, not `connected`; **M-4** a throwing `applyToken` in the
  refresher is caught + retried like a mint failure (no unhandled rejection, refresh survives); **L-1** `AskTutorButton`
  stops the client on unmount (no hot mic / minting loop); **L-2** `TokenRefresher.stop()` is now permanent (a late
  `start()` can't re-arm). Clean: VoiceClient failure paths, refresher stop-while-mint-in-flight, ttft guards.
- *Efficiency:* **HIGH (also flagged by robustness L-3) FIXED** — `logVoiceTurn` was doing two DB writes/turn
  (insert + reconcile-update) and the update could silently fail leaving `transcriptLogId:''`; now it generates the row
  uuid app-side (`randomUUID`) and embeds it pre-insert → **one write**, no reconcile, no orphan. **Fixed:** removed the
  dead `void buildVoiceSystemPrompt/voiceCacheKey` calls in the bridge. **Recorded (no change):** rate-limiter map is
  bounded across windows but not within one (acceptable at single-process scale — comment tightened); `getTracer`-per-turn
  and `process.env`-per-request are deliberately **not** hoisted — both are cold-path (per-turn / rate-limited) and
  hoisting would break test isolation (the OTel in-memory provider registers after import; the integration test toggles
  voice env per-case and relies on the route reading it live).
- *Regression tests added* for every fix: tokenRefresh (applyToken-throw retry, permanent stop), client (stop-during-start
  abort), AskTutorButton (unmount stops client), voiceTurn (single-insert id triple-equality), bridge (no phantom turn
  after barge-in). Full suite **436 passed | 1 skipped** (the 1 skip pre-existing), typecheck clean, agent `docker build`
  boots + serves the new endpoint.

### Smoke — Step 7 (whole-feature, coordinator-run on the corrected code)
Booted the full stack — agent (`:8098`, against the test Postgres, voice configured) + Vite dev server (`:5173`,
proxying `/api`+`/agent` to the agent) — and drove the **real** app in a headless Chromium against the **live proxied
agent** (no route mocks). Observed:
```
LIVE_SMOKE { agentConn: "open",            // WS to the real agent connected (regression: lesson workspace healthy)
             realtimeMintHit: 1,           // exactly one POST /api/realtime/session, only AFTER the click
             voiceStateAfterClick: "error",// fake token can't complete a real WebRTC join — the documented live gap
             api: ["POST /api/session", "POST /api/session", "POST /api/realtime/session"] }
```
- Regression check (neighbouring existing path): the text "Ask the tutor" form rendered (count 1) and the agent
  WebSocket reached `open` — the existing lesson loop is unbroken.
- Voice affordance: `data-voice-state="idle"` at load with **zero** token-endpoint calls before the click — **criterion 6
  verified through the running UI**; the click then triggered exactly one live token mint.
- The post-mint `error` state is the expected, documented deferred-live gap (no real LiveKit Cloud to join), not a defect.

### Retro

1. **Learned about the system, not in the architecture?** The voice channel turns the app-wide "anonymous `sessionId` is
   the bearer capability" property into a **live-audio eavesdrop/inject escalation** if a `sessionId` leaks (it was
   text-only before). ADR-004 flags FERPA sensitivity but doesn't name this consequence. → **Propagated to ROADMAP**
   (the "Production-grade auth" deferred item now names the escalation + the fix: a `learnerId` owner check in the mint
   route when auth lands). Not a new ADR — it's a known-deferred-auth consequence, not a new decision.
2. **Learned that changes the roadmap?** The mocked-boundary approach means F-11/F-12 build on a **contract that is
   proven but whose live transcript round-trip is unverified** until a human runs the smoke with keys. → **Propagated to
   ROADMAP** (the wire-contract row's I2 update spells out the `RealtimeSession` seam F-11 extends + the live-unverified
   caveat).
3. **What contract changed?** Only additive + at the right source of truth: one append-only REST route
   `POST /api/realtime/session` and one new `events.kind` string `voice_turn` (no migration; `events.payload` was already
   JSONB). `packages/contract`'s wire union was **not** touched (voice is WebRTC, not the WebSocket) — confirmed by both
   the spec-compliance and security reviewers. Dependents see the addition via the ROADMAP I2 contract note.
4. **What should the next builder do differently?** (a) The `RealtimeSession` interface is the **frozen seam** — F-11
   extends it (add transcript/rubric hooks), never reshapes it. (b) OTel **exporters** are F-20's job; F-10 only emits via
   the API (no-op until then) — don't add an SDK exporter in F-11. (c) The live round-trip needs the user's
   `LIVEKIT_*` keys + OpenAI Realtime access in `.env`; `docs/voice-cross-platform-smoke.md` is the script to tick.
   (d) One Vite wart: the runtime-assembled `livekit-client` dynamic import emits a non-fatal "cannot be analyzed"
   build warning — intended (optional peer dep), harmless; a `/* @vite-ignore */` would silence it if it bothers anyone.

Nothing warranted a CLAUDE.md change — the existing invariants (server-never-trusts-client, append-only contracts,
Docker-COPY-for-runtime-reads) already cover this feature's footguns.

### Propagated to
- **ROADMAP.md** — wire/REST contract row gets an I2 (F-10) update (new route + `voice_turn` kind + the mocked
  `RealtimeSession` seam F-11 extends + live-unverified caveat); the "Production-grade auth" deferred item names the
  voice-audio eavesdrop escalation + the owner-check fix for when auth lands.
- **ARCHITECTURE.md / ADRs** — nothing; ADR-006 already locked the voice stack and the mocked boundary is a build
  choice, not a design decision.
- **CLAUDE.md** — see Review round 2 below (the config-fail-closed lesson warranted an addition).

### Review round 2 — MR !5 automated review (Cursor bot: 4 high, 8 medium, 1 low)

A second adversarial pass (the forge's review bot) caught real issues the in-build waves missed. **Fixed (11 threads):** mic track never published to the room (join ≠ heard); the bridge now builds + passes the persona `RealtimeSessionConfig` to `connect(config)` (the seam signature changed — `connect` now takes the config); `AskTutorButton` is a start/stop toggle (was no in-UI way to end a session); `TokenRefresher` rejects a non-finite `expiresAt` (NaN delay → tight loop) and gives up after N consecutive failures via `onGiveUp`, which `VoiceClient` surfaces as an error; `completeTurn` double-insert race closed via the synchronous swap + empty-turn guard; `POST /api/realtime/session` returns 503 when `LIVEKIT_URL` is empty (was 201 with `url:""`); `readJsonBody` enforces a request timeout (slowloris → 408); the token-TTL test asserts `exp` within the signed window, not the SDK-controlled `exp - nbf`. **Responded/deferred (2 threads):** the two HIGH "sessionId-as-bearer → audio eavesdrop" findings — a pre-existing app-wide property (the sessionId is the bearer capability across the whole WS protocol), already recorded + propagated to ROADMAP last round; the full fix needs app-wide auth, out of F-10 scope.

**Compound — propagated:**
- **ROADMAP.md** (I2 contract note) — the `RealtimeSession.connect(config)` signature change F-11 builds on; plus two voice-wiring lessons the bot caught: (1) `publishTrack` after `room.connect` (joining ≠ heard), (2) the non-finite-JSON-numeric-into-a-timer guard.
- **CLAUDE.md** — a new "External-service config fails closed" invariant: an env-gated integration (LiveKit now; PostHog/LangSmith/OTel in F-20) must validate *every* field its response depends on and serve a clean 503 on partial config, never a half-valid 201. Sibling of the mastery fails-closed rule.
