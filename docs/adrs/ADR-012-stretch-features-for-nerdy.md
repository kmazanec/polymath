# ADR-012: Three MVP+ features (mastery telemetry in Nerdy KPI shape; FERPA/accessibility posture; cross-lesson recall instrumentation) plus a stretch order of L3 → L4 → Handoff-to-tutor → Teacher artifact → L5 Playground

**Status:** Accepted · **Date:** 2026-05-27 · **Stretch:** mixed (some yes, see body)
**Supersedes:** none · **Superseded by:** none

## Context

The brief asks us to do "narrow, excellent" rather than "broad, generic," but it also asks the submission to demonstrate domain insight and judgment. Three categories of work beyond the brief are worth considering:

- **Brief-core stretch** — features the brief explicitly invites but didn't require (e.g., more lessons, the playground, a multi-device companion).
- **Company-fit stretch** — features that demonstrate we understand Nerdy specifically (not just generic EdTech).
- **Engineering rigor extras** — privacy posture, accessibility, cross-lesson telemetry — small effort, large credibility.

COMPANY.md surfaced strong candidates in each category:
- Mastery telemetry that maps to Nerdy's published "double growth" claim
- Handoff-to-human-tutor moment (respects the 40,000+ vetted-experts moat)
- Teacher-side artifact in VT4S / Teacher Copilot shape
- FERPA / accessibility / privacy posture (they sell to 1,000+ districts)
- Cross-lesson recall (engineering rigor)

This ADR allocates them between MVP-included, stretch, and beyond-stretch.

## Options considered

**A — Build only brief-mandated MVP, no extras.** Tighter scope. Loses the Nerdy-specific framing. Submissions that look identical to a generic EdTech entry don't stand out.

**B — Include three small extras in MVP; defined stretch order for the rest (chosen).** Three small, high-leverage Nerdy-specific extras are folded into MVP (mastery telemetry shape, privacy/accessibility writeup, cross-lesson recall). The brief-core lessons (L3, L4) and the company-fit flex (handoff-to-tutor, teacher artifact) and the capstone (L5 playground) follow a defined priority order in stretch.

**C — Try to include everything as MVP.** Overcommits the budget; weakens the polish on each piece; risks the brief's "narrow, excellent" criterion.

## Decision

### MVP-included extras (locked into the core build)

1. **Mastery telemetry in Nerdy's KPI shape.** A small dashboard view in the app (`/session/:id/report`) that emits pre-test diagnostic score, post-test score, time-on-task, transfer-task success rate, and a normalised "growth multiplier" in the same shape as Nerdy's publicly cited claim that *"students who receive consistent, AI-enabled high-dosage tutoring double their growth in core subjects compared to standard interventions."* The dashboard is for the evaluator (not the learner); it makes the claim "our mastery signal produces telemetry of the kind Nerdy already publishes" demoable in one click. Build cost: ~1 day.

2. **FERPA / accessibility / privacy posture (built + written).** Both an in-app reality and a ~200-word section in the decision log. Specifically:
   - **No facial affect / eye tracking** (already committed in [ADR-004](./ADR-004-modalities-and-sensors.md); restated in the privacy section)
   - **No webcam access at any point in MVP** (verifiable property)
   - **No minor PII retention by default** — session IDs are opaque tokens; PostHog session replay is opt-in and off by default; logs anonymised before persistence
   - **WCAG 2.1 AA contrast** — color-blind-safe palette; minimum 4.5:1 contrast on body text; 3:1 on UI components
   - **Keyboard-first navigation** — every interaction operable via keyboard; visible focus indicators; arrow-key navigation in the gate canvas
   - **Reduced-motion preference honored** — the `<AnimateOrNot>` wrapper from [ADR-008](./ADR-008-frontend-and-client-architecture.md) reads `prefers-reduced-motion`; the pulse animation falls back to step-through navigation
   - **Screen-reader announcements** — pulse propagation, mastery transitions, transfer-probe entry/exit all announce textually
   - **Session data deletion on session close** by default, with a 24-hour grace period for the eval/replay tool
   Build cost: ~half day writing + accessibility audit folded into the week-3 polish work.

3. **Cross-lesson recall instrumentation.** Already partially designed in [ADR-002](./ADR-002-curriculum-scope-and-mvp-cut.md). Lifted to MVP visibility: in Lesson 2 (composition), the inner agent has an explicit action `recall_lesson1_kc` that surfaces a Lesson 1 KC if it detects regression. The recall is visible to the learner as *"You mastered AND in Lesson 1 — here's how AND shows up in this composed expression."* Demonstrates intra-curriculum memory. Build cost: ~1 day above the existing recall-detection infrastructure.

### Stretch features, in priority order

1. **Lesson 3 — NAND universality.** Already locked as stretch in [ADR-002](./ADR-002-curriculum-scope-and-mvp-cut.md). Highest priority because it's brief-core and unlocks the "aha" demo moment.

2. **Lesson 4 — De Morgan's law.** Already locked as stretch in [ADR-002](./ADR-002-curriculum-scope-and-mvp-cut.md). Second priority because it closes the curriculum arc and provides the *named misconception defense* (Almstrum 1996's halfway-application).

3. **Handoff-to-human-tutor moment.** Third priority because it is the strongest *Nerdy-specific* signal we can ship. A polished UI moment at session end (or earlier, if the learner triggers it): *"I've taken you as far as I usefully can on this. Here's a one-page summary of what we covered, where you got stuck, and what to ask in your next live tutoring session."* The artifact is a downloadable PDF or shareable URL, content auto-populated from the session log + mastery state. Demonstrates respect for Nerdy's 40,000+ vetted-experts moat and signals we understand their business (AI amplifies tutors; it doesn't replace them). Build cost: ~2 days. *No other submission will have this.*

4. **Teacher-side artifact in VT4S shape.** Fourth priority. A small report-card-style summary that maps to Nerdy's existing "Teacher Copilot" / 40+ teacher tools surface area: per-KC mastery, per-misconception flags, suggested next-session focus. Builds on the same session-log → summary pipeline as the tutor handoff. Build cost: ~2 days incremental after the handoff.

5. **Lesson 5 — Playground (capstone).** Fifth priority. Free-build mode. If reached, it's the demo flex. Already noted in [ADR-002](./ADR-002-curriculum-scope-and-mvp-cut.md) as beyond-stretch.

Decision rule: at each weekly checkpoint, complete the highest-priority stretch item that is achievable in the remaining time without compromising MVP polish. Do not start an item if it cannot be finished. **Cut stretch decisively before sacrificing MVP polish.**

## Rationale

### Why these three for MVP

Each of the three MVP+ extras is **small effort with disproportionate credibility return** for THIS company:

- **The mastery-telemetry-in-Nerdy-shape** turns our evaluation evidence into "they already think in these terms" — Cohn has repeated the "double growth" claim publicly; producing telemetry that matches the shape of that claim makes the eval message *theirs*, not ours.

- **The FERPA/accessibility/privacy posture** is the kind of "thought about something you didn't have to" that institutional sales prospects look for. Nerdy sells into 1,000+ K-12 districts; their VP of Privacy is a named exec. Showing we understand the privacy posture earns institutional credibility cheaply.

- **Cross-lesson recall** is the *strongest available demonstration that the architecture is more than a single-lesson app*. With L1+L2 as the MVP, this is the moment that proves the cross-lesson value of the statechart and the BKT estimate are not theoretical.

### Why handoff-to-tutor is the high-priority stretch

The handoff moment is the single feature that most distinguishes us from a generic submission. Most candidates will treat this as Nerdy-vs-the-tutor; we're treating it as Nerdy-with-the-tutor. That alignment with their actual business model is a one-sentence interview answer ("we built the system to hand off, not to replace, because that's how Nerdy's business actually works") that most submissions will not have prepared.

It also lets us be honest about the limits of the AI tutor: there are things the system cannot reasonably teach (motivation, deep conceptual confusion that needs a human, social-emotional support), and explicitly designing for handoff at those moments is the *responsible* AI-tutor design.

### Why teacher artifact follows handoff

The teacher artifact serves a similar purpose for the VT4S (institutional) line of business but is less brief-aligned and less universally meaningful. If we ship the handoff, the teacher artifact reuses the same summary pipeline; if we don't, we don't ship a half-built version.

### Defensibility for Nerdy

- **Cohn (CEO)** — the mastery-telemetry-in-Nerdy-shape and the handoff-to-tutor moment are the two pieces that map most directly to his publicly stated business strategy. He has *personally* committed $30M to the AI bet plus AI-amplifies-tutors framing.
- **Dalmia (VP Eng)** — will respect the accessibility / privacy posture as production-grade thinking and the cross-lesson recall as architecturally meaningful.
- **Hunigan (VP AI)** — will respect the handoff moment as responsible AI design ("the system knows what it doesn't know").
- **Harrison Glenn / Tom Bauer (likely PM/EM level)** — these are *the* features that read as "this candidate did their homework on Nerdy." Most submissions will be company-generic; ours is company-specific.

## Tradeoffs & risks

- **MVP+ scope creep.** Three additional features in MVP is real risk. Mitigation: each is small (≤1 day); we have a week-3 checkpoint that cuts MVP+ items before brief-core items if needed.

- **The mastery-telemetry KPI shape depends on Nerdy's published claim staying stable.** Mitigation: cite the public source (varsitytutors.com/schools) and treat the shape as a *target*, not a contract.

- **The handoff feature looks like "we're conceding the AI can't tutor."** Mitigation: framing matters. The handoff is *triggered intentionally* — by genuine pedagogical reasons (deep conceptual confusion, off-topic but important, learner overwhelm) — not by failure. The demo script shows this distinction explicitly.

- **FERPA / accessibility posture is *posture*, not certified compliance.** Mitigation: language in the writeup is careful — "designed to align with FERPA principles and WCAG 2.1 AA" not "FERPA-compliant" or "WCAG-certified."

- **Cross-lesson recall depends on Lesson 1 + Lesson 2 both being polished.** Mitigation: scope L1 deliberately small so L2 finishes by the week-3 checkpoint and the recall feature has both halves to operate on.

- **Stretch ordering depends on weekly checkpoints.** Mitigation: hard checkpoints at end of week 3 (cut MVP+ items if MVP not done) and end of week 4 (cut stretch items if MVP+ not done).

- **Stretch features below #2 may never ship.** Mitigation: this is the *correct* outcome if MVP and L3+L4 are not polished. The brief explicitly rewards depth.

## Consequences for the build

- **`apps/web/src/views/SessionReport.tsx`** — the mastery-telemetry dashboard at `/session/:id/report`. Renders pre/post-test scores, time-on-task, transfer success, growth multiplier in Nerdy KPI shape.
- **`docs/privacy-and-accessibility.md`** — the FERPA/accessibility posture writeup. Both a public-facing document and the source for the in-app "About this session's data" affordance.
- **`apps/web/src/components/CrossLessonRecall.tsx`** — the visible recall component triggered by the agent's `recall_lesson1_kc` action.
- **`apps/agent/src/agent/menu.ts`** — gains the `recall_lesson1_kc` action variant in the bounded menu.
- **Accessibility audit** — added to week-3 polish tasks: keyboard navigation across the gate canvas, screen-reader announcements, color-blind-safe palette confirmation, reduced-motion behavior.
- **`apps/web/src/views/TutorHandoff.tsx`** (stretch) — the handoff artifact. Auto-populated from session-log + mastery-state via a small LangGraph summarisation subgraph in `packages/graph/handoff/`.
- **`apps/web/src/views/TeacherReport.tsx`** (stretch) — the VT4S-shaped teacher artifact. Reuses the same summarisation pipeline as the handoff.
- **Weekly checkpoint schedule:**
  - End week 1: MVP architecture + Lesson 1 in dev
  - End week 2: Lesson 2 + cross-lesson recall + privacy/accessibility writeup
  - End week 3: MVP polish complete + chat-baseline experiment subjects scheduled; MVP+ telemetry dashboard live
  - End week 4: Stretch begins (L3); chat baseline running
  - End week 5: L4 + handoff feature
  - End week 6: Final polish, decision log, limitations memo, submission
- **The demo deck order** — opens on the curriculum arc (showing breadth); deep-dives on the L1+L2+cross-lesson recall (showing depth and the architecture working); shows the chat-baseline experiment results; shows the handoff moment (if shipped) as the Nerdy-specific finish.
