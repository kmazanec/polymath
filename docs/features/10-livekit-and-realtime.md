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
- [ ] **C3 — LiveKit Agents bridge** (T-10c) — `voice/bridge.ts` joins room as agent participant,
  proxies audio to/from `RealtimeSession`, handles barge-in (interrupt on learner audio). → criterion 3.
- [ ] **C4 — voice_turn event + OTel attrs** (T-10e, T-10g) — `voice/voiceTurn.ts` (Zod payload) +
  `voice/otel.ts` (span with the 8 required attrs, no-op exporter); bridge persists each turn. →
  criteria 2, 7.
- [ ] **C5 — Browser voice client + Ask-the-tutor affordance** (T-10b) — `apps/web/src/voice/client.ts`
  + `AskTutorButton` requesting mic permission on click only, calling the token endpoint. →
  criteria 1, 6.
- [ ] **C6 — Token refresh across the 5-min boundary** (T-10a/b) — transparent re-mint before
  expiry. → criterion 8 (refresh).
- [ ] **C7 — Playwright desktop e2e + cross-platform checklist + Caddy note** (T-10h, T-10f) —
  Playwright (fake media device) asserts transcript appears; `docs/voice-cross-platform-smoke.md`
  scripted per ADR-006; confirm token endpoint passes through Caddy. → criterion 4 (desktop only).
- [ ] **Review (Step 6)** — Wave 1 spec+security, Wave 2 robustness+efficiency; high/medium fixed.
- [ ] **Smoke (Step 7)** — drive the web dev server (mocked boundary) end-to-end + regression.

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
