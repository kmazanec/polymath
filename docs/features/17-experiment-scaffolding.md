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

## Build plan (approved)

> Planned by kmaz-plan-iteration (architect + researcher + contrarian, reconciled). Iteration slug
> **`i3i4-lessons2-baseline`**. **Model tier: Opus** — adds 4 tables + a boot-path migration
> (blast radius = whole agent) + the subject↔session linkage contract that AC#5 depends on.
> **Build order: SECOND in I4, strictly after F-16.** Concurrent with I3 (different files).

**⛔ BLOCKING PRECONDITION — the item bank is too small for the design (verified: exactly 8 L1 transfer items).**
The protocol needs, per subject, mutually-exclusive sets: 4 pre + 4 post + 2 followup = **10 distinct L1 items minimum** (and if the two conditions each get their own 4-item post-test per ADR-011, **14**). Only **8** exist (`L1-01-and`…`L1-08-or-and`). **AC#6 ("pre-test items never offered in post-test/followup") is unsatisfiable as written** — the runner throws "insufficient unseen items" on the first real subject. Also: "different surface form" (T-17c) has **no backing field** — the only proxy is `targetRep`. **Keith must choose before F-17 builds (manifest Q):**
- (i) **Author ≥6 more validated L1 transfer items** (clean fix; an ADR-010 5-layer content task, not free), OR
- (ii) **Relax AC#6**: the two conditions share ONE held-out 4-item post-test (sound experimentally), and the followup reuses pre/post items in a *different `targetRep`* — gives `4 pre + 4 shared-post = 8` exactly + followup-by-rep-override. Tight, zero slack, but feasible with 8.
The build adopts **(ii)** unless Keith picks (i). The lifecycle test must run against the *real* bank size (or assert the insufficiency), not an oversized fixture that hides the bug.

**Three more decisions the build inherits (verified):**
- **CSVs do NOT persist to disk under the deploy model.** The image is a curated COPY + release-symlink atomic swap; a write into `experiments/baseline/results/` is orphaned on next deploy, and CI must not write into the checkout. **Source of truth = Postgres tables; export = a streaming `GET …/export.csv` endpoint** (build the CSV in-memory from the tables). The `experiments/baseline/results/*.csv` path is downgraded to "where the operator saves the download." Column shape is FROZEN (AC#5, F-21 reads it): `subject_id,condition_order,pre_test_score,polymath_session_id,polymath_post_score,baseline_session_id,baseline_post_score,followup_score,qualitative_notes` (scores 0.0–1.0; missing = empty string).
- **No subject↔session linkage exists.** `/api/session` inserts `.values({})`; `sessions` has no `subjectId`. AC#5's `polymath_session_id`/`baseline_session_id` would be hand-pasted UUIDs (fragile). **Add `subjectId` (+ reuse F-16's `app`) to `sessions`** (additive) and thread an optional `subjectId` through session creation so both apps create their session *through* the subject and the CSV joins automatically. Coordinate with F-16.
- **`subject_id` parity for counterbalancing (T-17f).** UUIDs have no odd/even. Compute condition order from the **ordinal** (`count+1`): odd→Polymath-first, even→baseline-first; store it explicitly in `condition_order`. The **followup URL token is a SEPARATE random column**, never the subject id (a sequential id would be enumerable).

**Checklist:**

- [ ] **Schema + migration (Opus, boot-path blast radius).** Add tables to `apps/agent/src/db/schema.ts`: `experiment_subjects` (`condition_order`, `qualitative_notes`, `polymath_session_id`/`baseline_session_id` FK→sessions, random `followup_token` unique, `followup_expires_at`, `created_at`), `pre_test_results`, `post_test_results` (`condition`), `followup_results` (`target_rep_override`), and `subject_item_usage` with **composite PK `(subject_id, item_id)`** (the schema-level half of AC#6's exclusion — backstops the application-level filter). Generate via `drizzle-kit generate` (NEVER hand-edit `drizzle/meta/`); additive only. Migration test: fresh Postgres → `runMigrations` → all tables present.
- [ ] **Item selection + exclusion.** `sampleUnusedItems(bank, usedSet, n)` mirroring `readTransferCandidates`'s filter shape, but `usedSet` sourced from the subject's `subject_item_usage`/result rows (across sessions), L1 only; throws `InsufficientItemsError` (which, with 8 items + design (ii), it won't). Unit-test the exclusion + the boundary.
- [ ] **Scoring — reuse the shared var-capped equivalence module** (the same one F-16 uses), scored against `transfer_bank.targetExpression`. No parallel scoring path.
- [ ] **REST endpoints (mirror `handleRealtimeSession` body-read/validate/respond):** `POST /api/experiment/subjects` (ordinal counterbalance + random followup token), `POST …/pretest/{start,submit}`, `POST …/posttest/{start,submit}` (set `followup_expires_at = now+48h` after the 2nd post-test), `GET|POST /api/experiment/followup/:token` (Postgres-backed token + expiry — must survive redeploys; serves 2 different-`targetRep` items), `GET /api/experiment/subjects/:id/export.csv` (stream from Postgres), `POST …/subjects/:id/session` (link a session id). Register as `if (method && pathname)` blocks before the 404; validate UUIDs with the existing `UUID_RE`.
- [ ] **Subject↔session linkage.** Add `subjectId` to `sessions` (additive); accept optional `subjectId` at session creation; both apps create through the subject.
- [ ] **Operator artifacts (`experiments/baseline/`).** `protocol-checklist.md` (agent-authored, full runbook), `consent-form.md` (**agent scaffolds structure; Keith writes/reviews legal content — ~½ day, manifest Q**), a self-contained `operator-runner.html` (vanilla JS, fetches `/api/experiment/*`), `results/.gitkeep`. Add `experiments/baseline/results/*.csv` to `.gitignore` (research data, privacy).
- [ ] **Tests (OFFLINE, rides `agent_test`).** Full lifecycle integration (create→pretest→[inject session ids as fixtures, NO LLM session leg]→posttest→followup→CSV column shape); item-exclusion (a pre-test item never appears in post-test; DB-constraint backstop); followup expiry (backdate `followup_expires_at` → 410). Must not need `OPENAI_API_KEY`.
- [ ] **Verify:** `pnpm typecheck` · migration test · `pnpm --filter @polymath/agent exec vitest run` (experiment suite) · `pnpm --filter @polymath/agent test` · `pnpm test` · `docker build -f apps/agent/Dockerfile -t polymath-agent:f17 .` then boot against a fresh Postgres (catches a journal/migration mismatch — the boot-crash blast radius).

**Convergence:** isolated to `apps/agent/src/experiment/` + additive `schema.ts`/`server.ts` route blocks + `experiments/` docs — no I3 file overlap. Depends on F-16 (the `app` discriminator + per-session log shape + the `subjectId` linkage). **Frozen before F-21:** the 4 table shapes + the 9-column CSV.

## Implementation notes (filled in by the building agent)

> Empty.
