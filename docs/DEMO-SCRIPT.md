# Polymath — demo script

The demo arc, end to end. Each beat is a single, observable moment; the final beat
is the tutor-handoff artifact, which is what ties the whole thing back to Nerdy's
business model (AI *amplifies* human tutors — see [ADR-012](./adrs/ADR-012-stretch-features-for-nerdy.md)).

## The arc

1. **Open a lesson — the UI is alive.** Toggle truth-table inputs, drag a gate, watch
   the pulse animation. The correctness verdict lands instantly (client-only; the
   network never sees a toggle). This is the "hyperresponsive" claim, demoable in the
   first ten seconds.

2. **Practice to the rule gate.** A few correct items at the hardest tier flips the
   server-derived rule gate (BKT ≥ threshold + consecutive-correct + no-hints +
   response-time band). The gate is computed server-side from the full event log — not
   the client flag.

3. **Transfer probe — can they do it without the crutch?** A held-out representation is
   excluded; the probe measures genuine transfer. Asking for the hidden rep is refused
   warmly by the interface itself.

4. **Explain-back — the integrity boundary.** The learner speaks their reasoning; the
   deterministic preconditions run first, then the LLM judges the *explanation* (never
   the Boolean answer). A "mastered" learner cannot have pattern-matched or pasted an
   LLM answer.

5. **Cross-lesson recall (L1 → L2).** The architecture proves it is more than a
   single-lesson app: a regressed earlier-lesson KC surfaces a non-destructive recall
   callout mid-practice.

6. **🏁 Final beat — hand off to a human tutor.** Click **"I'm ready to hand off to a
   tutor"** (visible from any phase). The system generates a polished, shareable,
   printable one-page artifact for the session, auto-populated from mastery state:

   - a **warm 1-line intro** — *"I've taken you as far as I usefully can on this…"*,
     never *"I failed to teach you"*;
   - **what the learner mastered** (KCs at/above the lesson's BKT threshold);
   - **where a human can help most** (KCs below threshold);
   - **3–5 concrete questions to bring to a Nerdy human tutor**, generated from the
     stuck KCs (warm enrichment questions if nothing is stuck);
   - a **Nerdy-aligned footer** framing the live session as the next step.

   Three forms, one page: the in-product card (`/handoff/:sessionId`), a **shareable
   URL** (`/handoff/:sessionId/:token`, authenticated by a random per-session token —
   not the guessable UUID), and **"Print → Save as PDF"** (`@media print` +
   `window.print()`; no Puppeteer, no Chromium in the image).

   This is the beat that lands the alignment with Nerdy's thesis — *the AI does the
   high-frequency mastery work and prepares the learner for the human*, rather than
   replacing the tutor. It is the single feature most distinguishing the submission
   from a generic EdTech candidate (ADR-012).
