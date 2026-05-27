# ADR-011: Mastery gate parameters (BKT 0.95 + consecutive-3 + 2/60s response-time band + behavioral flags + transfer + explain-back); six counter-metrics; N=5–8 wizard-of-oz chat-baseline comparison with honest reporting

**Status:** Accepted · **Date:** 2026-05-27 · **Stretch:** no
**Supersedes:** none · **Superseded by:** none

## Context

The brief sets an unusually demanding bar for evaluation:
- Mastery defined as what the learner can now do (not "scored 80%")
- Counter-metrics that defend against bad responsiveness and shallow learning
- Evidence that the adaptive UI helps versus a chat-only baseline (*"Branching is not enough"*)
- A transfer moment / assessment
- A decision log and a limitations memo as deliverables

Earlier ADRs settled most of the mastery architecture:
- Maximalist gate (rule-based + BKT + behavioral signals + transfer probe + explain-back rubric) — Round 0
- Held-out hand-curated transfer bank — [ADR-002](./ADR-002-curriculum-scope-and-mvp-cut.md), [ADR-010](./ADR-010-content-correctness-and-validation.md)
- Five-layer content validation — [ADR-010](./ADR-010-content-correctness-and-validation.md)

This ADR locks the concrete parameter values, the counter-metric set with thresholds, the chat-baseline experiment design, and the commitment to a decision log and limitations memo.

## Options considered

### Mastery gate parameters

**A — Defaults as listed below (chosen).** Corbett-Anderson BKT priors with arithmetic-style adaptation; consecutive-correct=3 (Carnegie MATHia default); response-time floor 2s / ceiling 60s (Beck 2005; Baker et al. 2008); BKT threshold 0.95 (standard mastery-learning probability). Configurable per lesson via `lessons/*/mastery_config.json`.

**B — Tighter (BKT 0.99, consecutive-4).** Fewer false-positive masteries; many more items per learner. Risk: "too long to reach mastery" hurts the demo.

**C — Lighter (BKT 0.85, consecutive-2).** Easier to reach mastery in MVP; weaker false-positive defense. Rejected — the brief penalises lightweight mastery declarations.

### Counter-metrics

**D — Six counter-metrics (chosen):**
| # | Metric | Brief concern it addresses |
|---|--------|----------------------------|
| 1 | UI churn rate (mounts/min) | "Did the UI change too often?" |
| 2 | Learner-perceived intelligibility of changes (sampled) | "Did learners understand why the interface changed?" |
| 3 | Visual representation utility (time-to-correct delta) | "Did the visual surface help reasoning or just decorate?" |
| 4 | Dependency check (transfer-vs-practice time delta) | "Did responsiveness make the learner more dependent?" |
| 5 | Sensor signal validity (Cohen's κ between rubric and transfer) | "Did sensor input improve experience or create false confidence?" |
| 6 | False-positive mastery rate (24h follow-up transfer) | "Did the system mistake pattern-matching for mastery?" |

Metric 6 is **out of scope to measure in MVP** but **in scope to design for**, documented in the Limitations memo. The mastery model is designed to support a 24h-follow-up validation; running it at scale requires longitudinal eval.

**E — Add a seventh metric: NASA-TLX style cognitive load self-report.** Defensible polish; ~30s of friction per session. Deferred — the six metrics already cover the brief's named concerns; a NASA-TLX add-on can come in a later ADR.

**F — Drop metric 6 — don't promise what we can't test.** Tighter scope. Loses the "we designed for this signal" framing.

### Chat-baseline experiment design

**G — N=5–8 wizard-of-oz with honest reporting (chosen).** Same Lesson 1 across both conditions, pre/post tests from the held-out bank, 24h transfer follow-up (feasible at this small N). Each subject does both conditions in counterbalanced order. Report effect sizes and direction; explicitly claim no statistical significance.

**H — Single-subject demo with side-by-side video.** Pure illustrative; no comparative claim possible.

**I — Skip the experiment; structural argument only.** Risky — the brief explicitly asks for evidence.

**J — Larger N (10–20) with shorter sessions.** More statistical weight; doubles subject-recruitment overhead and may not generate stronger claims given multiple confounds.

## Decision

### Mastery gate parameters

```jsonc
{
  // Per-lesson configurable in lessons/<id>/mastery_config.json
  "consecutiveCorrectAtHardestTier": 3,
  "hintsUsedInLastN_items": 0,           // N = 3
  "responseTimeFloorMs": 2000,           // below = guess flag
  "responseTimeCeilingMs": 60000,        // above = stuck flag
  "responseTimeMedianBandMs": [2000, 60000],

  // BKT (Corbett-Anderson 1995 priors, conservative)
  "bktMasteryThreshold": 0.95,
  "bktPrior_L0": 0.30,                   // P(L_0): prior probability of mastery
  "bktTransition_T": 0.20,               // P(T): probability of learning per attempt
  "bktGuess_G": 0.15,                    // P(G): probability of guessing correctly
  "bktSlip_S": 0.10,                     // P(S): probability of slipping when known

  // Behavioral poison flags (any one closes the gate)
  "hintRatioMax": 0.20,                  // hints / items overall
  "retryRatioMax": 0.30,                 // retries / items overall

  // Transfer (required)
  "requireHandCuratedTransfer": true,
  "requireDifferentRepresentation": true,

  // Explain-back rubric (required for integrity)
  "requireExplainBackPass": true
}
```

**Citations for the choices** (these go in the writeup):
- BKT priors: Corbett & Anderson 1995, "Knowledge tracing: Modeling the acquisition of procedural knowledge."
- Mastery threshold 0.95: standard mastery-learning probability; Khan Academy uses comparable threshold in production BKT.
- Consecutive-3: Ritter et al. 2007, MATHia / Cognitive Tutor cognitive-model gating.
- Response-time floor 2s: Beck 2005, "Engagement tracing"; Baker et al. 2008 on "gaming the system" detection.

### Counter-metrics

| # | Metric | Operationalization | Threshold for "pass" |
|---|--------|---------------------|----------------------|
| 1 | **UI churn rate** | Component mounts per minute of learner engagement, segmented by phase | <1.5/min during practice; 0 during transfer probes |
| 2 | **Learner-perceived intelligibility** | Sampled post-mount check: "Did the change make sense?" Yes/No/Skip; sampled at ~1 in 3 mounts | ≥80% "yes" responses |
| 3 | **Visual representation utility** | Time-to-correct on items presented with the circuit view visible vs. hidden, on a sample of identical items | Visual-visible items have ≥15% lower time-to-correct on novel items |
| 4 | **Dependency check** | Median time-to-correct on transfer items (no scaffolds) vs. final practice items (scaffolds present) | Transfer-item time within 25% of practice-item median |
| 5 | **Sensor signal validity** | Cohen's κ between explain-back rubric pass/fail and held-out transfer pass/fail on the same subject | κ ≥ 0.5 (moderate agreement) |
| 6 | **False-positive mastery rate** | % of declared-mastered learners who fail a third-rep transfer item 24h later | <10% (designed-for, measured on N=5–8 baseline experiment subjects only) |

Each metric reports to a PostHog dashboard (UI churn, intelligibility) or a LangSmith eval bucket (rubric correlation), with raw event data in Postgres for ad-hoc analysis.

### Chat-baseline experiment

- **Design:** Within-subject counterbalanced. Each subject does Lesson 1 (basic operators) on both **Polymath** (our system) and **Chat-baseline** (a GPT-5-powered chat interface with text + LaTeX responses but no statechart, no curated components, no mastery gate, no transfer probe beyond a stock end-of-session check). Order counterbalanced (~half chat-first, ~half Polymath-first).
- **Subjects:** N=5–8 (Keith + friends + family). Honest about the convenience sample.
- **Pre-test:** 4 items from the held-out bank, before either condition.
- **Post-test:** 4 different items from the held-out bank, after each condition.
- **24h follow-up transfer:** 2 items from a different surface form, 24 hours after the last condition. Subjects unwitting of which condition produced higher mastery prediction.
- **Measures:** Time-to-mastery (where applicable), post-test score delta from pre-test, 24h follow-up score, qualitative per-subject reflections.
- **Reporting:** Per-subject deltas plotted; group-level effect sizes (Cohen's d) reported with explicit "N=8 is not statistically powered" disclaimer; any subjects where chat outperformed Polymath are reported in full, not omitted.

The experiment is **scheduled for week 3** (after MVP architecture is stable) and runs through week 4 (subject sessions) into week 5 (24h follow-ups and analysis).

### Decision log + Limitations memo

- **Decision log** = a public-facing ~2-page summary derived from the ADRs in `docs/adrs/`. Lists every consequential decision with one-paragraph rationale. Final-week deliverable.
- **Limitations memo** = an honest list of:
  - What was scoped out (stretch lessons if not reached, multi-device companion, 24h follow-up at scale, NASA-TLX cognitive load self-report)
  - What could break our claims (transfer bank repeat across sessions, L3 free-form hint accuracy, agent hallucination patterns we haven't catalogued, accessibility gaps we didn't have time to audit)
  - What we'd build next with another 4 weeks
  - Final-week deliverable.

Both documents are **part of the submission**, not internal artifacts.

## Rationale

### Why these specific BKT parameters

Corbett-Anderson 1995 is the canonical BKT paper; their parameter ranges for arithmetic skills (P(G)=0.1–0.3, P(S)=0.05–0.15, P(T)=0.1–0.4) cover our values. P(G)=0.15 is the midpoint — conservative without being adversarial. P(L_0)=0.30 reflects that the average learner entering the lesson has *some* prior exposure to basic logic but is not yet fluent across representations.

Mastery threshold 0.95 is the standard "mastery learning" probability dating to Bloom (1968) and used in Khan Academy's BKT implementation. 0.99 would require more items than fit in a single session; 0.85 would let in too many false positives.

Response-time floor 2s is consistently the documented threshold below which responses are "gaming" or guessing (Baker et al. 2008). Setting the floor lower would let in lucky guesses; setting it higher would penalise fast-but-correct learners.

### Why six counter-metrics, not three

The brief lists seven specific counter-metric *questions*. We mapped them to six measurable metrics (questions 1 and 2 from the brief — "Did UI change too often" / "Did learners understand why" — are tightly coupled and addressed by our metrics 1+2). Each of the six maps to a brief-named concern verbatim. Skipping any of them leaves the corresponding concern undefended.

Metric 6 (24h false-positive rate) is the most important — it directly answers the brief's hardest question ("Did the system mistake pattern-matching for mastery?") — and the only one we cannot measure at scale in 4–6 weeks. We *measure it on the baseline experiment subjects* (N≤8) and document it as "the system is designed to surface this signal; a production deployment would run this longitudinally." That is the most honest position available.

### Why the N=5–8 wizard-of-oz is the right experiment

The brief asks for *evidence* the adaptive UI helps. Three alternatives we considered:
- **Argument from architecture alone.** Too weak; brief explicitly says "Branching is not enough."
- **Single-subject demo video.** Illustrative, not evidential.
- **Statistical RCT (N≥30).** Out of budget; would consume the entire build period.

N=5–8 within-subject counterbalanced is the strongest feasible experiment. The *honesty* of the reporting — "small N, not statistically significant, here are the observed effects and the per-subject data" — is itself a defense. A submission that overclaims (N=8 with confident statistical significance) is weaker than one that honestly reports limitations.

The 24h follow-up at this N is also feasible — 5–8 subjects each completing a 10-minute session can be scheduled. At N=30 it would not be.

### Defensibility for Nerdy

- **Cohn (CEO)** — will care about the *publicly defensible mastery claim*. Our claim ("learners who pass our mastery gate show specific behavioral signals plus pass a held-out transfer in a different surface form plus pass an integrity-bounded explain-back") is auditable. He can repeat it.
- **Hunigan (VP AI)** — will recognise BKT + behavioral signals + LLM-judged rubric as the right composition for the problem. He'll respect that we're not claiming the LLM is the mastery oracle.
- **Dalmia (VP Eng)** — will appreciate the parameter-file pattern (everything configurable, nothing hard-coded), the per-metric thresholds, and the explicit "designed-for but not measured at scale" status of metric 6.

The single strongest defense sentence: *"Our mastery signal combines a published BKT model with explicit behavioral poison flags, a hand-curated transfer probe in a different representation, and a voice-based explain-back with five deterministic preconditions before any LLM judgment. We test the validity of that signal against held-out transfer success on the baseline experiment subjects."*

## Tradeoffs & risks

- **BKT priors are domain-portable but not Boolean-specific.** Mitigation: re-tune in week 3 based on observed data; document the tuning process in the decision log.

- **N=5–8 is statistically weak.** Mitigation: the within-subject counterbalanced design is the strongest available; honest reporting; effect-size direction is the claim, not significance.

- **Friends/family bias.** Mitigation: explicit caveat in the writeup; sample diversity is what's feasible in 4–6 weeks.

- **Wizard-of-oz baseline could be unfair to the chat condition** if we build it lazily. Mitigation: the chat baseline uses the same LLM, the same content correctness validation, the same hint quality. The *only* differences are: no statechart, no curated components, no mastery gate, no transfer probe, no explain-back. We document what the baseline does *do* well.

- **Counter-metrics may show our system failing on metric 1 or 3.** Mitigation: this is *fine and good*. The brief explicitly rewards counter-metrics; if we report honestly and the system fails on one, we have an honest discussion in the limitations memo. Submissions that report all-passing metrics are less credible than submissions that report mixed results.

- **The 24h follow-up depends on subject availability.** Mitigation: schedule with subjects in advance; offer flexible time windows; document subjects who drop out.

- **The explain-back rubric ↔ transfer correlation (metric 5) depends on enough data.** With N=8 we have at most 8 mastery declarations × 1 transfer item each. Mitigation: acknowledge the N; report κ but with wide CI; document this as a metric that strengthens at scale.

- **PostHog session replay for metric 1 (UI churn rate)** is privacy-sensitive. Mitigation: opt-in consent collected from baseline experiment subjects; replay off by default in production.

## Consequences for the build

- **`lessons/<id>/mastery_config.json`** — parameter file per lesson; loaded at lesson entry; hot-reloadable during dev for tuning.
- **`packages/bkt`** — pure-TypeScript BKT update + threshold check. ~150 lines, fully tested.
- **`apps/agent/src/mastery/gate.ts`** — the master gate predicate, combining BKT + rule-gate + behavioral + transfer + explain-back. Single function, fully tested with property-based tests.
- **`apps/agent/src/metrics/`** — counter-metric emitters. Each metric has a clear emission point (mount → metric 1; sampled prompt → metric 2; etc.).
- **PostHog dashboards** — pre-configured for the six counter-metrics; embedded in the demo deck as evidence.
- **LangSmith eval buckets** — for metric 5 (rubric-transfer correlation); week-3 deliverable.
- **`experiments/baseline/`** — the wizard-of-oz chat baseline app (a minimal Next.js chat app sharing the validator from `packages/booleans`); IRB-light consent form; per-subject session protocol checklist; pre/post-test bank reference.
- **`experiments/baseline/results/`** — per-subject data; raw and aggregated.
- **`docs/decision-log.md`** — final-week deliverable; summary of every ADR in 1–2 paragraphs each.
- **`docs/limitations-memo.md`** — final-week deliverable; honest catalogue of what we didn't build and what could break our claims.
- **The demo deck** — slide on mastery model (with the JSON config visible); slide on counter-metrics (with thresholds and observed values); slide on baseline experiment (with per-subject results and explicit "N=8" disclaimer).
