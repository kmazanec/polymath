# Feature: Explain-back rubric subgraph (5 deterministic preconditions + LLM judge)

**ID:** F-11 · **Iteration:** I2 — Voice + full mastery gate · **Status:** Not started

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

## Implementation notes (filled in by the building agent)

> Empty.
