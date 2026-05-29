# Baseline experiment — operator protocol checklist

A printable runbook for running one subject through the within-subject,
counterbalanced study comparing **Polymath** against the **chat baseline**
(ADR-011). Print one copy per subject; tick each box as you go.

The experiment **source of truth is Postgres** — the runner endpoints write there
directly, and the per-subject CSV is a streaming download. Nothing is written to
disk on the server; you save the CSV download yourself (suggested:
`experiments/baseline/results/<subject_id>.csv`).

Open `operator-runner.html` (in this directory) in a browser pointed at the
agent (`?api=https://polymath.biograph.dev` or your local `http://localhost:8080`)
to drive every step below from one page.

---

## Per-subject run

**Subject:** ____________________   **Date:** ____________   **Operator:** ____________

- [ ] **1. Consent.** Walk the subject through `consent-form.md`; obtain a signature
      (paper or e-sign). Do **not** proceed without it.
- [ ] **2. Create the subject row.** In the runner, click **Create subject**. Record:
      - Subject ID: ________________________________
      - Condition order (assigned automatically, counterbalanced by ordinal):
        `polymath_first` ☐ / `baseline_first` ☐
      - Follow-up token (a random secret — NOT the subject id): ____________________
- [ ] **3. Microphone test.** Confirm the subject's mic works (Polymath's explain-back
      needs it). Have them say a test sentence; confirm you see audio levels.
- [ ] **4. Pre-test (4 items).** Click **Start pre-test** → present the 4 items →
      enter the subject's answers → **Submit pre-test**. The 4 items are now held out
      from the post-test (enforced by the schema).
- [ ] **5. Condition 1 session.** Run whichever arm the condition order names first:
      - If `polymath_first`: run the **Polymath** lesson; then click **Link session**
        with `arm = polymath` and the session id Polymath shows.
      - If `baseline_first`: run the **chat baseline**; then **Link session** with
        `arm = baseline`.
- [ ] **6. Brief break** (~5 min). Water, stretch — reduce fatigue carryover.
- [ ] **7. Condition 2 session.** Run the other arm; **Link session** with its `arm`.
- [ ] **8. Post-test — condition 1 arm.** **Start post-test** → present the 4
      *remaining* items → enter answers → **Submit post-test** with the
      `condition` matching the arm the subject just finished first.
- [ ] **9. Post-test — condition 2 arm.** Submit the post-test again with the other
      `condition` (the two arms share the SAME held-out 4-item set — design (ii)).
      Submitting the second condition's post-test **opens the 24h follow-up window**
      (valid 48h).
- [ ] **10. Provide the 24h follow-up URL.** Give the subject:
      `…/api/experiment/followup/<follow-up token>` (or the runner's follow-up link).
      Tell them: open it 24–48h from now; it presents 2 items in a *different*
      surface form. After 48h it expires (returns 410).
- [ ] **11. Qualitative reflection.** Ask the subject for a short reflection ("which
      felt like it taught you more, and why?"). Click **Save notes** to store it.
- [ ] **12. (After 24h) confirm follow-up done.** The subject runs the follow-up URL
      themselves; no operator action needed beyond reminding them.
- [ ] **13. Export.** Click **Download CSV** → save to
      `experiments/baseline/results/<subject_id>.csv`. The row has the frozen
      9-column shape (F-21 reads it):
      `subject_id, condition_order, pre_test_score, polymath_session_id,
      polymath_post_score, baseline_session_id, baseline_post_score,
      followup_score, qualitative_notes`.

---

## Notes & gotchas

- **Counterbalancing is automatic.** The condition order is computed from the
  subject's creation ordinal (odd → Polymath first, even → baseline first) and
  stored on the row — you don't choose it.
- **Item exclusion is enforced by the database**, not just the UI: a pre-test item
  can never be served in the post-test/follow-up for the same subject.
- **The follow-up token is a random secret.** Treat it like a password — anyone with
  the URL can submit the follow-up. It is not the subject id.
- **Scores are 0.0–1.0** (fraction correct). A blank cell in the CSV means that
  phase was not run (≠ 0.0).
