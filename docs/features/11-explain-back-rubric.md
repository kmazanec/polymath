# Feature: Explain-back rubric subgraph (5 deterministic preconditions + LLM judge)

**ID:** F-11 · **Iteration:** I2 — Voice + full mastery gate · **Status:** Planned (build plan approved 2026-05-28)

## What this delivers (before → after)

**Before:** Transfer probes pass or fail, but no follow-up integrity check exists. The brief's hardest requirement — "design against learners who succeed only while the UI is doing the reasoning for them" — has only the structural transfer defense, not the explain-back defense.

**After:** Immediately after a learner passes a transfer probe (`transfer_submitted` with `correct: true`), the agent emits a `mount` of `ExplainBackPrompt` with `targetItemId`, a prompt body, and `maxDurationSec: 15`. The browser TTSes the prompt (~3 seconds), then opens a 15-second voice recording window. The recording is transcribed and routed to a LangGraph subgraph that runs **5 deterministic preconditions** first ([ADR-010](../adrs/ADR-010-content-correctness-and-validation.md)): duration ≥3s, duration ≤15s, word count ≥10, contains KC vocabulary, **contains an item-specific reference**. Any precondition failure produces an automatic rubric fail with a stock retry prompt explaining what was missing; no LLM call. If all preconditions pass, the LLM judge stage runs: classify the explanation kind, check item-specific reasoning, judge prosody (thinking-vs-reading), score against rubric, emit verdict. The LangSmith eval bank for explain-back judgment passes at ≥90% agreement with hand labels.

This is the integrity boundary. After F-11 merges, the anti-cheat thesis is observable.

## How it fits the roadmap

I2, **on the critical path**. Convergence point: F-12's mastery gate consumes F-11's verdict.

## Dependencies (must exist before this starts)

- **F-07** — transfer probe emits `transfer_submitted` that triggers the explain-back flow.
- **F-10** — voice/Realtime stack live; transcripts available.

## Unblocks (what waits on this)

- **F-12** — full mastery gate consumes the explain-back verdict.

## Contracts touched

- **`ComponentSpec`** — `ExplainBackPrompt` variant in F-01 schema. F-11 implements rendering.
- **`Action` schema** — extends with `propose_explain_back_prompt` (or, simpler, emits a `mount` of `ExplainBackPrompt`; reuse the existing `mount` Action). No new variant.
- **Curated component registry (rendering)** — adds the `ExplainBackPrompt` case.
- **`events` table** — gains `explain_back_recording_ended` event kind. Append-only.
- **LangGraph explain-back subgraph** — `packages/graph/explainback/`. Introduced here. The 5 preconditions + LLM judge nodes per [ADR-010](../adrs/ADR-010-content-correctness-and-validation.md).
- **Mastery config** — extends with explain-back-specific tunable thresholds (preconditions are mostly fixed; LLM judge agreement threshold is configurable).
- **KC vocabulary list** — `lessons/1/kc_vocabulary.json` introduced here for L1. Extended by F-13, F-22, F-23 for L2/L3/L4.
- **Labelled eval bank** — `evals/explain_back/` with ~30 labelled pass/fail recordings.

## Sub-tasks

1. **T-11a — `<ExplainBackPrompt>` React component** `[parallel]`
   - Mounts on transfer-pass.
   - TTSes the prompt via the Realtime API (single ~3s read).
   - Opens a 15s recording window; visible countdown.
   - On window close: sends `explain_back_recording_ended` event with the transcript (or signals "no audio captured").
2. **T-11b — Stage 4a — 5 deterministic preconditions** `[parallel]`
   - LangGraph node: `checkPreconditions(transcript, prosody, itemId): { passed: boolean, failedReason?: string }`.
   - Each precondition is a small pure function; preconditions order matters (return on first fail to save downstream work).
3. **T-11c — Stage 4b — LLM judge subgraph** `[parallel after T-11b]`
   - Nodes: classify (memorised-generic vs. item-specific) → check item-specific reasoning → judge prosody (reading-vs-thinking) → score → emit verdict.
   - LangGraph multi-step; checkpointed.
4. **T-11d — KC vocabulary list for L1** `[parallel]`
   - `lessons/1/kc_vocabulary.json` with the term list from [ADR-010](../adrs/ADR-010-content-correctness-and-validation.md).
5. **T-11e — Retry-prompt copy + selection logic** `[parallel after T-11b]`
   - Each precondition failure has a specific stock retry prompt ("try referring to the specific gates you used", "your response was too short — try again").
6. **T-11f — Labelled eval bank** `[parallel]`
   - 30 hand-curated explain-back recordings + transcripts + verdicts.
   - LangSmith eval at ≥90% agreement.
7. **T-11g — Tests** `[parallel]`

## Acceptance criteria (product behavior)

1. **Immediately after a transfer-probe pass**, the agent emits `mount ExplainBackPrompt`; the browser TTSes the prompt and opens a 15s recording window.
2. **If the learner says nothing for 15 seconds (silence)**, precondition `duration ≥3s` fails; the rubric returns fail with a retry prompt asking the learner to please respond.
3. **If the learner speaks for more than 15s** (cut off by the window), precondition `duration ≤15s` is satisfied by construction; the recording is processed.
4. **If the learner says "yeah I just used the AND and OR gates" (10+ words, includes KC vocab, no item-specific reference)**, the `contains item-specific reference` precondition fails; the rubric returns fail with a retry prompt asking the learner to "try referring to the specific variables in the problem you just solved."
5. **If all preconditions pass**, the LLM judge runs; the verdict is returned within ~2 seconds of the recording ending.
6. **The LangSmith eval bank passes at ≥90% agreement** with hand labels — CI gate.
7. **The verdict is logged in the `events` table** with full precondition statuses + LLM judge sub-scores.
8. **A failed rubric loops back to `ExplainBackPrompt`** (retry, ≤2 total attempts), then escalates to a hint or back to practice if both fail.
9. **The 15-second window is enforced server-side as well as client-side** — a manipulated client cannot extend it.
10. **Prosody features** (filled pauses, mid-utterance silences) are captured from the Realtime API and included in the LLM judge's input.

## Testing requirements

- Unit tests for each precondition function; full coverage.
- Integration test: synthetic recordings (text-only stand-ins) drive the full rubric flow.
- LangSmith eval at ≥90% on the labelled bank (CI gate).
- Component test for `<ExplainBackPrompt>`: countdown, recording controls, retry behavior.

## Manual setup required

- **Authoring the 30 labelled explain-back recordings** — ~1.5 days of Keith + family/friends recording sessions, then hand-labelling. Schedulable to week 1–2.
- KC vocabulary list per lesson is small — ~half day to author L1's list.

## Convergence and expected rework

⚠ **LangSmith ≥90% agreement gate** is a CI hard-block. If the agreement rate is below threshold on first eval, the prompt or precondition logic needs tuning. Mitigation: budget 2 days of prompt iteration before opening the F-11 PR.

⚠ **F-12 depends on F-11's verdict shape.** Lock the verdict object shape `{ passed: boolean, reasons: string[], llmJudgmentDetail?: object }` early in F-11; F-12 reads it.

⚠ **iOS Safari TTS quirk** — the Realtime TTS may behave differently. Test in T-10h covers this; if iOS fails, document in limitations.

## Build plan (approved)

> Synthesized from architect/researcher/contrarian drafts (kmaz-plan-iteration, 2026-05-28),
> judged + reconciled against ground-truth code. **The spec's "Contracts touched" list above is
> stale (pre-F-01) — treat it as verify-only.** Verified: `ExplainBackPrompt` (component.ts:88-92)
> + `COMPONENT_KINDS`, the `explain_back_recording_ended` ClientEvent (wire.ts:113-118), the `mount`
> Action, and `LearnerState.explainBackPassed` (gate.ts) **all already exist**. F-11 is wiring over
> inert contracts, not new schema. See [BUILD-PLAN.md](../BUILD-PLAN.md) for the iteration DAG +
> frozen contracts. Everything **fails CLOSED**: any missing input, unconfigured judge (no key), or
> thrown error → `{ passed: false }` with a named reason — never a degraded pass.

**Approved decisions (this build):**
- **Verdict type home → `packages/contract`** (`@polymath/contract`), re-exported. NOT `packages/graph` —
  so the agent reads the shape without taking a graph workspace dep (avoids a Dockerfile COPY pair for F-12).
- **Persistence slot → `payload.explainBackVerdict`** in the explain-back turn's `events` row, mirroring
  `payload.transferVerdict` (server.ts:649). The F-11→F-12 convergence point; frozen via a shared fixture.
- **Trigger placement → DETERMINISTIC SERVER-SIDE REFLEX.** On a transfer-pass (with
  `requireExplainBackPass`), the server mounts `ExplainBackPrompt` directly — NOT an LLM menu move.
  Keeps it off the forgeable/jailbroken-LLM path and out of the two-place `menu.ts`/`openaiClient.ts`
  lockstep. (Supersedes stubClient's transfer-pass `no_action` arm for the mount.)
- **Prosody (AC#10) → ROUTE EXPLAIN-BACK THROUGH THE WebRTC BRIDGE** (full fidelity, chosen over
  descope). Explain-back audio flows over the F-10 `RealtimeSession` seam (`apps/agent/src/voice/`):
  a phase-scoped `explain_back` bridge captures the learner utterance, and prosody features (filled
  pauses, mid-utterance silences) are pulled from the realtime transcript stream into the judge input.
  The bare `explain_back_recording_ended` event remains the *server-side completion signal*; the
  transcript + prosody arrive via the bridge. **This is the largest-scope item in I2 — budget for it.**
- **Eval CI gate → text-only synthetic stand-ins** until the ~30 real recordings land (matches the
  existing skip-offline/run-on-key eval pattern); offline preconditions-vs-labels assertion always green.
- **KC vocab #4 vs item-reference #5 are DISTINCT code paths** (ADR-010 §Tradeoffs) — conflating them
  voids the anti-cheat. #4 = generic KC terms from `kc_vocabulary.json`; #5 = the just-probed item's
  variable names + operators (var-capped). F-11 must NOT emit `transition→mastered` (F-12 owns that).

**Frozen contract signatures (this feature):**
- `packages/contract/src/explainBack.ts` (NEW, re-exported from `@polymath/contract`):
  `export interface ExplainBackVerdict { passed: boolean; reasons: string[]; llmJudgmentDetail?: Record<string, unknown> }`
- `export type PreconditionReason = 'duration_too_short' | 'duration_too_long' | 'too_few_words' | 'no_kc_vocab' | 'no_item_reference' | 'judge_unavailable'`
  (`'judge_unavailable'` = the fail-closed reason on no-key / judge throw / missing judge).
- `packages/graph` (NEW workspace pkg) — `checkPreconditions(input: { transcript; durationMs; maxDurationSec; kcVocabulary: string[]; itemTokens: string[]; prosody?: ProsodyFeatures }): { passed: boolean; failedReason?: PreconditionReason }` (pure, ordered, first-fail; reads SERVER-clamped duration).
- `packages/graph` — `interface ExplainBackJudge { judge(input: { transcript; itemTokens: string[]; kcVocabulary: string[]; prosody?: ProsodyFeatures }): Promise<{ passed: boolean; subScores: Record<string, boolean | number> }> }` (DI-injected stub in tests; `@langchain/openai withStructuredOutput` impl key-gated — mirrors the `MoveProvider` split).
- `packages/graph` — `runExplainBack(input, deps: { judge?: ExplainBackJudge }): Promise<ExplainBackVerdict>` (LangGraph StateGraph: preconditions → conditional edge → fail-emit (no LLM) | judge → emit; missing judge / throw → `{ passed:false, reasons:['judge_unavailable'] }`).
- `MasteryConfig` (append-only, OPTIONAL): `explainBackJudgeAgreementThreshold?: z.number().min(0).max(1).optional()`. (Single agreed name — F-12 reads the same key.)
- `eventConsumer.ts` (additive): `LoggedEvent` gains `explainBackPassed?: boolean`; `DerivedState` gains `explainBackPassed: boolean` (init false); `deriveState` gains an `explain_back_recording_ended` branch; **replace the hardcoded `explainBackPassed: false` at eventConsumer.ts:174** with the derived value.
- RELIES ON, NO CHANGE: `ComponentSpec.ExplainBackPrompt`, the `explain_back_recording_ended` ClientEvent, the `mount` Action, `gate.ts isMastered` reading `LearnerState.explainBackPassed`.

**Build checklist (test-first):**

- [ ] **PHASE-0 BARRIER (land first, ~1 commit):** create `packages/contract/src/explainBack.ts` exporting `ExplainBackVerdict` + `PreconditionReason`; re-export from `@polymath/contract`. Add a shared test fixture asserting the `payload.explainBackVerdict` slot shape. This is the single point of serialization with F-12 — once landed, both features build against a fixed type.
- [ ] **VERIFY-ONLY** the stale-spec contract claims: a test that `ExplainBackPrompt` parses via `ComponentSpec` and `explain_back_recording_ended` parses via `ClientEvent` (both already exist). Confirm NO new `Action` variant. **Do NOT add `propose_explain_back_prompt` to action.ts** — the spec is pre-F-01 and wrong.
- [ ] Scaffold `@polymath/graph` workspace pkg (copy `packages/bkt` layout): package.json, tsconfig extending base, vitest config. Deps: `@polymath/contract` + `@polymath/booleans` + `@langchain/langgraph` + `@langchain/core` + `@langchain/openai` + zod (match `apps/agent` versions). Add `@polymath/graph` to `apps/agent/package.json`. `pnpm install` + `pnpm typecheck` to prove the workspace resolves BEFORE logic.
- [ ] **DOCKERFILE LOCKSTEP (do WITH the scaffold, not at the end):** `apps/agent/Dockerfile` — deps stage `COPY packages/graph/package.json packages/graph/`; runtime stage `COPY packages/graph packages/graph`. `kc_vocabulary.json` rides under the existing `COPY lessons lessons` — verify it lands. Do NOT COPY `evals/` (CI/test only). Prove with a real `docker build` + `docker run … ls packages/graph lessons/1/kc_vocabulary.json` + `/api/health`.
- [ ] Author `lessons/1/kc_vocabulary.json` (generic L1 KC terms per ADR-010 Layer 4: AND, OR, NOT, true, false, output, input, gate, expression, …). Extend `apps/agent/src/lessons/loader.ts` to read it as OPTIONAL `kcVocabulary?: string[]`; **NON-FATAL read** — missing/garbled → empty list → precondition #4 fails CLOSED (logged, never a crash, never a pass).
- [ ] **TEST-FIRST (T-11b):** `packages/graph/src/explainback/preconditions.test.ts` covering all 5 ADR-010 preconditions in fixed order, first-fail: (1) duration ≥3000ms, (2) duration ≤`maxDurationSec`*1000, (3) wordCount ≥10, (4) ≥1 KC vocab term (case-insensitive, word-boundary), (5) ≥1 ITEM-SPECIFIC token (the just-probed item's vars + operators) — DISTINCT from #4. Cover AC#2 (15s silence → `duration_too_short`), AC#4 (keyword-stuffing gamer → `no_item_reference`). Then implement `preconditions.ts` (pure; reads SERVER-clamped duration).
- [ ] Build the **item-token deriver** (server-side, `apps/agent` — the pkg never reads lessons): resolve the probed item's tokens from its `targetExpression` via `@polymath/booleans` `variables(parse(expr))` + operator literals. **VAR-CAP the parse** (reuse `MAX_SUBMIT_VARS=10`) — a forged/wide `targetItemId` must not force a 2^n parse (CLAUDE.md DoS invariant). Unknown/forged `targetItemId` → empty token set → precondition #5 fails CLOSED. Unit-test the fail-closed path.
- [ ] **WebRTC prosody capture (the AC#10 lift):** extend the voice path (`apps/agent/src/voice/bridge.ts` + `realtimeClient.ts` seam) with an `explain_back`-phase capture that pulls prosody features (filled pauses, mid-utterance silences) off the `RealtimeSession.onTranscript` stream into a `ProsodyFeatures` shape on the judge input. EXTEND the `RealtimeSession` interface, don't reshape it. Test with `MockRealtimeSession` driving synthetic disfluency markers. Document the cross-platform smoke deferral (needs real keys/devices, per `docs/voice-cross-platform-smoke.md`).
- [ ] **TEST-FIRST (T-11c):** `subgraph.test.ts` (deterministic, no key) asserting fail-closed wiring. Then `judge.ts` (`ExplainBackJudge` + `@langchain/openai withStructuredOutput` Zod impl producing ADR-010 sub-scores: memorised-generic-vs-item-specific, item-specific-reasoning, prosody thinking-vs-reading, overall) and `subgraph.ts` (LangGraph StateGraph). `runExplainBack`: missing/undefined judge / no key / throw → `{ passed:false, reasons:['judge_unavailable'] }`. Inject the judge double in tests.
- [ ] `packages/graph/src/explainback/retryPrompts.ts` (T-11e): pure `PreconditionReason → stock copy` lookup (`no_item_reference` → "try referring to the specific variables in the problem you just solved" per AC#4; `duration_too_short` → "please respond"; `too_few_words` → "your response was too short — try again"). Unit-tested.
- [ ] **TEST-FIRST (the I1 inert-refusal lesson — the single most important test):** a server integration test that POSTs a synthetic `explain_back_recording_ended` frame through `handleClientFrame` and asserts (a) a verdict event is logged with full precondition statuses + judge sub-scores (AC#7), and (b) a precondition-fail yields a retry `ExplainBackPrompt` mount (AC#8). **MUST fail before wiring exists** — proves the subgraph is REACHABLE, not just correct in isolation.
- [ ] **TEST-FIRST (AC#9 server-side window):** a failing integration test sending `explain_back_recording_ended` with manipulated/over-cap `durationMs`. Implement the route to link the event back to its `ExplainBackPrompt` mount (match `targetItemId` + most-recent unresolved mount; newest-first scan over the bounded `MAX_SESSION_EVENTS` log, mirroring `unresolvedProbeItemId`), read its `maxDurationSec`, compute `effectiveDurationMs = min(client.durationMs, maxDurationSec*1000)`; preconditions read `effectiveDurationMs`. An implausible/over-cap/inconsistent value is a precondition FAIL — a client cannot extend the window by lying.
- [ ] **WIRE THE ROUTE:** in `apps/agent/src/server.ts handleClientFrame`, add an `explain_back_recording_ended` branch BEFORE the generic agent turn (it does NOT go through `proposeMove`). It loads lesson + `kcVocabulary` + the probed item's tokens (via `targetItemId`) + the bridge's captured prosody, runs `runExplainBack`, persists an `events` row with `{ event, explainBackVerdict, validation: { layer: 4, status, detail: { preconditionStatuses, subScores } } }` (AC#7), and on FAIL re-mounts `ExplainBackPrompt` with retry copy, counting prior `explain_back_recording_ended` for this `targetItemId` from the bounded log, capping at 2 then escalating (HintCard / return to practice, AC#8). On PASS → ack/no_action; **F-11 STOPS at the verdict** (F-12 owns the transition). Rate/attempt-cap server-side so a client can't farm judge calls.
- [ ] **WIRE THE VERDICT INTO DERIVED STATE (the F-12 input):** in `eventConsumer.ts` add `explainBackPassed?: boolean` to `LoggedEvent`, `explainBackPassed: boolean` to `DerivedState` (init false), an `explain_back_recording_ended` branch in `deriveState`, and **replace the hardcoded `explainBackPassed: false` at line 174** with the derived value. In `server.ts toLoggedEvent` (line 81) project `payload.explainBackVerdict.passed`. Pure fold over the bounded log (server-derived, never a client flag). Unit-test: a logged passing verdict flips `toLearnerState().explainBackPassed` to true.
- [ ] **TRANSFER-PASS REFLEX:** when `computeTransferVerdict` returns `correct:true` and `requireExplainBackPass`, the server mounts `ExplainBackPrompt` (`targetItemId` = the passed transfer itemId, a `promptBody`, `maxDurationSec:15`) — deterministic, NOT via the LLM menu. Supersedes the stubClient transfer-pass `no_action` arm for the mount. Integration test: a passing `transfer_submitted` yields an `ExplainBackPrompt` mount with the correct `targetItemId` + `maxDurationSec:15`.
- [ ] **RENDER (T-11a):** in `apps/web/src/components/registry.tsx` move `ExplainBackPrompt` out of the Tbd group into a real `case` (the `never` default makes a miss a compile error; leave `ConfidenceCheck`/`MasteryCelebration` in Tbd). Build `apps/web/src/components/ExplainBackPrompt.tsx`: TTS the `promptBody` via the F-10 voice client (~3s), open a `maxDurationSec` recording window with a visible countdown over the WebRTC bridge, then dispatch `explain_back_recording_ended` (or signal "no audio captured" as an empty transcript → server precondition fails CLOSED). Handle no-mic / iOS-Safari-TTS gracefully (do not throw in render). Component test: countdown, recording controls, retry.
- [ ] Add `explainBackJudgeAgreementThreshold` (append-only OPTIONAL) to `packages/contract/src/lessonConfig.ts`; set it in `lessons/1/mastery_config.json`. Do NOT touch existing required keys.
- [ ] **EVAL BANK + CI GATE (T-11f, AC#6):** `evals/explain_back/` with ~30 labelled fixtures (text-transcript stand-ins + `durationMs` + `targetItemId` + expected pass/fail) and `eval.test.ts` (model on `apps/agent/src/agent/eval/eval.test.ts`) — an ALWAYS-ON offline preconditions-vs-labels assertion PLUS a key-gated `liveIt` LLM-judge run asserting ≥90% agreement. Wire into `.gitlab-ci.yml` as a hard block, matching the skip-offline/run-on-key pattern.
- [ ] **FULL VERIFICATION:** `pnpm typecheck`; `pnpm test`; `docker build` of `apps/agent` + boot (no `WORKSPACE_PKG_NOT_FOUND` / ENOENT on `kc_vocabulary.json`); manually drive transfer-pass → `ExplainBackPrompt` mount → `explain_back_recording_ended` → verdict persisted → `explainBackPassed` derived, end-to-end.

**Risks (carry into the build):**
- **Fail-open inversion (thesis-breaking):** the easiest bug is treating a missing input as a pass. Missing `kc_vocabulary.json`, empty transcript, judge throw/timeout, no key — EACH must yield `{ passed:false }`. Degrade-to-BLOCK, never degrade-to-pass.
- **Inert subgraph masked by green unit tests (the I1 lesson):** `preconditions.ts`/`judge.ts` can be 100% correct while nothing routes the event into them. Only the server-level integration test from the raw `ClientEvent` catches dead wiring.
- **WORKSPACE_PKG_NOT_FOUND at boot:** `@polymath/graph` without BOTH Dockerfile COPYs crashes the agent at boot → health-check rolls back. Only `docker build` sees it (the F-09 `@polymath/bkt` precedent).
- **Precondition #4 vs #5 conflation voids the anti-cheat.** Keep DISTINCT code paths.
- **Client `durationMs` trust (AC#9):** the route MUST link the event to its mount and clamp; there is no link today — must be built.
- **Var-cap on the precondition-#5 token derivation:** a new uncapped server-side parse on a client-supplied `targetItemId` is a DoS.
- **WebRTC prosody path (the chosen AC#10 route) is the highest-risk surface in I2** — reworks F-11's capture path; the live cross-platform smoke is deferred (needs real keys/devices). The bridge work and the route must not block the offline-testable subgraph.

## Implementation notes (filled in by the building agent)

> Empty.
