# Feature: Explain-back live transcript capture binding

**Status:** Done — with deferral (live device smoke is yours to run) · **Date:** 2026-06-06

## What this delivers (before → after)

**Before:** A learner can hold one continuous tutor conversation by voice (the live
LiveKit + OpenAI-Realtime bridge is constructed in `createServer` and runs per
session). But the **explain-back step** of that conversation — the one point where
voice is *required* — has no production wiring from the spoken transcript to the gate
that reads it. Nothing ever calls `ExplainBackCaptureRegistry.register(sessionId,
targetItemId, session)`, so `explainBackTranscriptFor` always returns empty, the
explain-back gate fails closed at precondition #3, and **`mastered` is unreachable for
any real learner.** (Integration tests only pass because they call
`server.explainBackCaptureRegistry.setTranscript(...)` by hand — simulating the binding
production never performs.)

**After:** When the server mounts the `ExplainBackPrompt` (the transfer-pass reflex),
it binds the session's already-running live `RealtimeSession` into the
`ExplainBackCaptureRegistry` for that item. The learner's spoken explain-back — part of
the same one conversation — is captured server-side and read as the integrity source by
the gate. A real spoken explain-back can now clear the gate and reach `mastered`,
with every existing integrity invariant intact.

## Requirements & acceptance criteria

It is **one conversation** (text or voice); the explain-back is the phase of that
conversation where voice is required and the spoken transcript is the integrity source.
The capture is a new consumer of the *same* `RealtimeSession.onTranscript` stream the
conversational bridge already uses — never a separate session.

- **AC-1 (register on mount):** *Given* a session with a live bridge registered in
  `liveBridgeRegistry`, *when* the server mounts an `ExplainBackPrompt{targetItemId}`,
  *then* `explainBackCaptureRegistry.register(sessionId, targetItemId, <the bridge's
  RealtimeSession>)` is called exactly once for that (session, item).
- **AC-2 (capture feeds the gate, no manual setTranscript):** *Given* register-on-mount
  has fired, *when* the learner's finalized explain-back transcript arrives on that
  session's `onTranscript` stream, *then* `explainBackTranscriptFor(sessionId,
  targetItemId)` returns that transcript — with **no** test-side `setTranscript` call.
- **AC-3 (fail closed, no bridge):** *Given* a session with **no** live bridge (voice
  unconfigured, or a text-only learner), *when* `ExplainBackPrompt` is mounted, *then*
  no `register` is attempted, `explainBackTranscriptFor` stays empty, and the gate fails
  closed at precondition #3 exactly as today (no crash, no throw).
- **AC-4 (integrity unchanged):** The transcript is read only from the server capture
  seam, never `event.transcript`; finalized learner segments only (the capture already
  enforces `role === 'learner'`); the spoken-turn one-shot/`takeLatest` semantics are
  untouched. No `ServerDeps` contract field is removed or reshaped.
- **AC-5 (end-to-end mastery, offline):** *Given* a session driven past the rule gate +
  a passed transfer (existing harness) with a live `MockRealtimeSession` bridge, *when*
  the learner speaks a valid explain-back over that session's stream and
  `explain_back_recording_ended` fires, *then* the gate clears and a
  `MasteryCelebration` mounts — **without** the test injecting the transcript by hand.
- **AC-6 (stale comment corrected):** The `ServerDeps` comments claiming the bridge "is
  NOT constructed in production yet" are corrected to reflect that the bridge IS
  constructed and the explain-back capture is now bound on mount (no overclaim, no
  understatement — the seam's docs must match reality).

## Approach

**Touches:** `apps/agent/src/server.ts` (the single `ExplainBackPrompt` mount site,
~L2998, and the `ServerDeps` voice comments), `apps/agent/src/voice/bridge.ts` (expose
the session), and tests in `apps/agent/src/server.integration.test.ts` (+ a focused
unit test). No contract change; no web change.

**Decisions (each with its WHY):**

1. **Expose `VoiceBridge.getSession(): RealtimeSession`** (a thin getter over
   `this.opts.session`). WHY: `register()` needs the session; the bridge already owns
   it; a getter is the smallest seam and keeps the binding logic in the server handler
   rather than leaking registry knowledge into the bridge.
2. **Bind at the `ExplainBackPrompt` mount, as a side effect — never change the action
   shape.** WHY: the mount is the exact moment the explain-back phase begins, has
   `targetItemId` + `sessionId` + `deps` in scope, and is a single site (`server.ts`
   L2998). Binding here is item-scoped and fail-closed (no bridge → no register).
3. **Reuse the existing capture window** (server-clamped `maxDurationSec` +
   `handleExplainBack` preconditions: duration ≥3s, word-count, KC-vocab, item-token
   reference). WHY: it is one conversation, so we do NOT add a separate start/stop
   capture protocol; the existing gates already bound and filter what counts, and
   `ExplainBackCapture` only ingests `role === 'learner'` finalized chunks.
4. **`register()` is idempotent per (session, item)** (already true in the registry), so
   a re-mount (reconnect) re-uses the existing capture rather than dropping the stream.
   WHY: matches the rest of the voice path's reconnect-idempotence discipline.

**Integrity invariants honored (CLAUDE.md):** transcript only from the server-captured
seam (never the client frame); finalized learner segments only; env-gated services fail
closed on partial config (no bridge when `voiceConfigured()` is false → no capture →
gate blocks); the seam comments are corrected so they do not claim a fill path that
doesn't exist.

## Build plan

- [ ] **Slice 1 — expose the session.** Add `VoiceBridge.getSession(): RealtimeSession`.
  Unit test: a bridge built over a `MockRealtimeSession` returns that same session.
  (Satisfies the mechanism for AC-1.)
- [ ] **Slice 2 — bind on mount (the core).** At the `ExplainBackPrompt` mount in
  `server.ts`, after deciding the action is the explain-back mount, look up
  `deps.liveBridgeRegistry?.get(sessionId)`; if present, call
  `deps.explainBackCaptureRegistry.register(sessionId, targetItemId,
  bridge.getSession())`. No-op when absent. Unit/integration test with an injected
  `MockRealtimeSession` bridge: mounting the prompt registers a capture (AC-1); a
  finalized learner transcript on that session then surfaces via
  `explainBackTranscriptFor` with no manual `setTranscript` (AC-2); a session with no
  bridge registers nothing and stays fail-closed (AC-3).
- [ ] **Slice 3 — end-to-end mastery without hand-injected transcript.** Add an
  integration test mirroring the existing mastery test, but instead of
  `server.explainBackCaptureRegistry.setTranscript(...)`, register a `MockRealtimeSession`
  bridge for the session and push the explain-back utterance through *its* transcript
  stream; assert the `MasteryCelebration` mounts (AC-5). Proves the production binding,
  not the test bypass.
- [ ] **Slice 4 — correct the stale seam comments** in `ServerDeps`
  (`explainBackCaptureRegistry`, `learnerUtteranceRegistry`, `createRealtimeSession`) so
  they state the bridge is constructed and the explain-back capture binds on mount; keep
  the fail-closed-until-configured wording accurate (AC-6).
- [ ] **Slice 5 — full agent suite green in isolation** (`pnpm --filter @polymath/agent
  test`), typecheck clean.
- [ ] **Slice 6 — live smoke checklist** (handed to the human; not run by the build):
  a precise step list to verify one full spoken mastery round-trip on one browser with
  real keys.

## Quality bars

- **Security / trust boundary:** This IS a trust-boundary feature. The transcript that
  clears mastery must come only from the server capture of the live session, never the
  client `event.transcript`. The binding does not introduce any client-controlled path —
  it attaches a server-owned capture to a server-owned session. A forged/text-only
  client simply has no bridge → no capture → fail closed. Preserved, not weakened.
- **Non-functional:** One `register()` call per explain-back mount; idempotent; O(1). The
  capture is one extra `onTranscript` subscriber on a stream that already exists. No new
  network, no new connection, no event-loop work on the hot submit path.
- **Observability:** Reuse the existing per-turn decision log; the explain-back turn
  already persists its verdict + gate evaluation to the event log (replayable). No new
  telemetry needed for this binding; n/a beyond what's already captured.

## Build plan — outcome

- [x] **Slice 1 — expose the session.** `VoiceBridge.getSession()` added; unit test green.
- [x] **Slice 2 — bind on mount.** `handleClientFrame` binds the live bridge's
  `RealtimeSession` into `explainBackCaptureRegistry.register(...)` whenever the wire
  action is an `ExplainBackPrompt` mount; no-op (fail closed) when no live bridge.
- [x] **Slice 3 — end-to-end mastery without hand-injected transcript.** Integration test
  drives rule-gate → transfer → spoken explain-back via a `MockRealtimeSession` pushed
  through the bound session → `MasteryCelebration`, with NO `setTranscript`. Plus a
  fail-closed test (no bridge → empty capture). Both green.
- [x] **Slice 4 — corrected the stale seam comments** in `ServerDeps`
  (`explainBackCaptureRegistry`, `learnerUtteranceRegistry`) and `explainBackRegistry.ts`
  so they state the binding is wired and only the live device smoke is deferred.
- [x] **Slice 5 — full agent suite green in isolation** (79 files, 710 passed, 4 skipped),
  typecheck clean; agent rebuilt and boots healthy (`/api/health` 200, provider openai).
- [ ] **Slice 6 — live device smoke** (yours to run; checklist below).

## Live smoke checklist (run with real keys — the deferred human step)

Prereq: set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OPENAI_API_KEY` in
the agent env (`.env` locally; `/etc/polymath/.env` on the droplet), then `docker compose
up -d --build agent`. Confirm `GET /api/health` is 200 and `GET /api/realtime/availability`
reports available.

1. Open a lesson, click "Ask the tutor" — grant mic. A voice session establishes
   ("Listening…"), proving `handleRealtimeSession` started a live `VoiceBridge`.
2. Drive one learner to the rule gate (clear AND/OR/NOT across reps), pass the transfer
   probe. The `ExplainBackPrompt` mounts and is read aloud.
3. **Speak the explanation** into the mic during the recording window (≥3s, reference the
   specific item, use the KC vocabulary). Stay on topic.
4. Confirm mastery: a `MasteryCelebration` mounts. In the session replay, the
   `explain_back_recording_ended` event shows `explainBackVerdict.passed === true` and the
   gate flips to passed — driven by the SERVER-captured transcript (the bound session),
   not a client-sent string.
5. Negative check (integrity): repeat but stay SILENT (or speak gibberish/off-topic). The
   gate must NOT pass (precondition fail / judge fail) — confirming fail-closed holds with
   the live capture, not just offline.

A single full pass on one browser (Chrome or Safari desktop) verifies this feature's
mastery path. The broader 5-platform matrix in docs/voice-cross-platform-smoke.md remains
the separate, wider voice smoke.

## Decisions, assumptions & blockers

**Decisions made:**
- *Bind at the finalized wire action, not inside the mount ternary.* WHY: binding keys off
  whatever action actually goes out as an `ExplainBackPrompt` (robust to any path that
  mounts it), and runs after `action` is settled by the B7 / wrong-submit nets.
- *`getSession()` on the bridge rather than reaching into the registry from the bridge.*
  WHY: smallest seam; keeps registry knowledge in the server handler, not the bridge class.
- *Reuse the existing capture window + preconditions; no separate start/stop protocol.*
  WHY: it is ONE conversation (Keith's framing) — the explain-back is the phase where voice
  is required; a separate capture session would contradict that and add plumbing for no
  gain. `ExplainBackCapture` already ingests only finalized `role==='learner'` segments.

**Assumptions (correct me if wrong):**
- The conversational `VoiceBridge` is live (constructed by `handleRealtimeSession`) at the
  moment the `ExplainBackPrompt` mounts — true in the normal flow where the learner opened
  voice earlier in the same session. If a learner reaches explain-back having never started
  voice, there is no bridge → fail closed (they must start voice to be assessed), which is
  the intended "voice required for explain-back" behavior.
- `OPENAI_REALTIME_MODEL` defaults to `gpt-realtime` (unchanged); no model pinning added.

**Deferred / blockers:**
- The live cross-platform DEVICE smoke (steps above) needs real keys + a mic; it is yours
  to run. All code + offline tests are complete and green. No code blocker remains.
