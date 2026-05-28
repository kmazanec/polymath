# Feature: Experiment scaffolding (pre/post tests, 24h follow-up, CSV export)

**ID:** F-17 · **Iteration:** I4 — Chat-baseline experiment · **Status:** Not started

## What this delivers (before → after)

**Before:** F-16 exists but the experiment infrastructure around it doesn't. A subject sitting down can play with Polymath or the baseline, but there's no protocol for the within-subject counterbalanced study ([ADR-011](../adrs/ADR-011-evaluation-and-mastery-instrumentation.md)) and no data export.

**After:** An `experiments/baseline/` directory holds:
- An operator-facing **subject protocol checklist** (markdown, printable).
- An **IRB-light consent form** (PDF or Markdown).
- A **pre-test runner** that pulls 4 random transfer-bank items and captures responses in a `pre_test_results` table.
- A **post-test runner** identical but pulling 4 *different* items (held out from the subject's earlier exposure within this session).
- A **24h follow-up runner**: 2 items in a different surface form, runnable from a URL given to the subject at session-end.
- A **CSV export** (`experiments/baseline/results/<subject_id>.csv`) per subject capturing pre/post scores, condition order, time-to-mastery (if declared), 24h transfer score, qualitative reflection field.

After F-17 merges, Keith can recruit a subject, run them through both conditions counterbalanced, capture 24h follow-up, and export per-subject data.

## How it fits the roadmap

I4, **off the critical path** (F-21 reads the data, but the experiment can be cut without breaking MVP). Concurrent with F-13/F-14/F-15.

## Dependencies (must exist before this starts)

- **F-16** — the baseline app has to exist.
- **F-08** — transfer bank for pre/post items.

## Unblocks (what waits on this)

- **F-21** — counter-metrics dashboard reads experiment results.

## Contracts touched

- **DB schema** — new tables `experiment_subjects`, `pre_test_results`, `post_test_results`, `followup_results`. Drizzle migrations.
- **REST API** — adds endpoints for experiment runners (`POST /api/experiment/pretest`, `POST /api/experiment/posttest`, `POST /api/experiment/followup`).
- **`transfer_bank`** — read-only consumer; the experiment must mark items as "used in pre-test for subject X" to avoid post-test contamination.

## Sub-tasks

1. **T-17a — DB schema + migrations** `[parallel]`
2. **T-17b — Pre/post test runner UI** `[parallel after T-17a]`
   - A small wrapper around Polymath (and around the baseline) that runs the test before/after the session.
   - Captures the subject ID + condition order + responses + scores.
3. **T-17c — 24h follow-up URL + runner** `[parallel after T-17b]`
   - Session-end: subject is shown a unique URL valid for 24-48h.
   - On click: 2 transfer items in a different surface form than what was practiced.
4. **T-17d — CSV export** `[parallel after T-17b]`
5. **T-17e — Operator protocol checklist + consent form** `[parallel]`
   - Markdown documents in `experiments/baseline/`.
6. **T-17f — Counterbalanced order assignment** `[parallel after T-17a]`
   - Subject ID is odd → Polymath first, baseline second; even → reverse.

## Acceptance criteria (product behavior)

1. **The operator (Keith)** can create a new subject row via a CLI command or admin endpoint; receives a subject ID + condition order.
2. **Running the pre-test for a subject** presents 4 random unseen transfer items; responses are captured and scored.
3. **Running the post-test** presents 4 *different* unseen items; responses captured and scored.
4. **The 24h follow-up URL** is unique per subject and expires after 48 hours; on access, presents 2 different-surface-form items.
5. **CSV export** for any subject produces a row with: subject_id, condition_order, pre_test_score, polymath_session_id (if applicable), polymath_post_score, baseline_session_id, baseline_post_score, followup_score, qualitative_notes.
6. **Items used in pre-test are excluded from post-test and follow-up** for that subject — enforced by the schema.
7. **The operator protocol checklist** lists every step (consent, baseline-first or polymath-first, microphone test, pre-test, condition 1 session, brief break, condition 2 session, post-test, 24h follow-up URL provision, qualitative reflection prompt).

## Testing requirements

- Schema migration test.
- Integration test: full subject lifecycle from creation through 24h follow-up + CSV export.
- Item-exclusion test: a subject's pre-test items are never offered in their post-test.

## Manual setup required

- **IRB-light consent form** drafting — ~half day of legal/writing work; Keith.
- Subject recruitment is itself manual; not blocking F-17 merge.

## Convergence and expected rework

None expected — `experiments/` directory is isolated.

⚠ **F-21 reads the data F-17 produces.** Lock the CSV column shape and the database table shapes before F-21 starts.

## Implementation notes (filled in by the building agent)

> Empty.
