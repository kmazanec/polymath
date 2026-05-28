# Explain-back eval bank (F-11, AC#6)

The labelled fixtures behind the explain-back rubric's CI gate (ADR-010 Layer 4).

**Two assertions, mirroring the F-05 inner-agent eval pattern
(`apps/agent/src/agent/eval/`):**

1. **Always-on, offline (no key):** every fixture's deterministic preconditions
   (`@polymath/graph` `checkPreconditions`) must agree with its hand label. This
   keeps the data honest without a key and runs in the `verify` CI job. Asserted in
   `packages/graph/src/explainback/eval.test.ts`.
2. **Key-gated live judge (`liveIt`):** when `OPENAI_API_KEY` is set, the LLM judge
   runs over the fixtures whose preconditions PASS and must agree with the hand
   labels at **≥ `explainBackJudgeAgreementThreshold`** (0.9, from
   `lessons/1/mastery_config.json`). Skipped without a key — same skip-offline /
   run-on-key pattern as the inner-agent gate.

**Why text stand-ins, not real recordings (the approved decision):** the ~30 real
recordings (+ prosody) are a manual authoring task scheduled to weeks 1–2 (see the
F-11 spec §"Manual setup required"). Until they land, the bank uses
text-transcript stand-ins with synthetic `durationMs`/prosody — enough to exercise
every precondition path and the judge prompt offline. The real recordings drop into
`recordings.json` (same shape) without a code change.

**NOT shipped in the Docker image** — `evals/` is CI/test-only (no `COPY evals` in
`apps/agent/Dockerfile`).

## Fixture shape (`fixtures.json`)

```jsonc
{
  "id": "string",                 // stable label
  "transcript": "string",         // the (stand-in) learner explanation
  "durationMs": 6000,             // already server-clamped in a fixture
  "maxDurationSec": 15,
  "kcVocabulary": ["AND", ...],   // generic lesson KC terms (#4)
  "itemTokens": ["A", "B", "AND"],// THIS item's vars + operators (#5)
  "prosody": { "filledPauses": 2, "midUtteranceSilences": 1, "restarts": 0 },
  "expectPreconditionPass": true, // the deterministic 4a expectation
  "expectFailedReason": "no_item_reference", // present iff expectPreconditionPass=false
  "expectJudgePass": true         // the hand label for the 4b LLM judge (only meaningful when preconditions pass)
}
```
