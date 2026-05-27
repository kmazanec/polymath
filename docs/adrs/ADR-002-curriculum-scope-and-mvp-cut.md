# ADR-002: Scope the prototype as a progressive curriculum with MVP = Lessons 1–2, Stretch = Lessons 3–4, Capstone = Lesson 5

**Status:** Accepted · **Date:** 2026-05-27 · **Stretch:** no
**Supersedes:** none · **Superseded by:** none

## Context

[ADR-001](./ADR-001-learning-domain-boolean-logic.md) commits to Boolean logic with a 5-lesson curriculum (basic operators → composition → NAND universality → De Morgan's → playground). The brief is explicit: "one tightly scoped learning goal." We are proposing what looks like five goals.

This ADR exists to (a) defend that what we're building is *one* goal — mastery of Boolean reasoning across representations — with a hand-curated difficulty progression, and (b) cut the prototype scope so the 4–6 week build delivers a *demonstrably* complete, defensible mastery flow on a subset of lessons while *proving* the architecture extends to the rest.

The risk if we get this wrong: either we ship 5 shallow lessons that fail the mastery bar, or we ship 1 deep lesson and the "this is really a curriculum" framing reads as scope creep.

## Options considered

**A — MVP = Lesson 1 only; everything else stretch.** Safest for the time budget. Lets us polish a single lesson to a high bar. But it weakens the "proves the architecture" story — a single lesson doesn't demonstrate that the statechart + inner-agent can handle lesson-to-lesson transitions, mastery-gated progression, or cross-lesson recall of prior concepts. The architectural claim is harder to defend with N=1.

**B — MVP = Lessons 1+2; Stretch = Lessons 3+4; Capstone = Lesson 5 (chosen).** Two lessons end-to-end exercises the inter-lesson transition (Lesson 1's mastery gate triggering Lesson 2 entry; Lesson 2 building on Lesson 1's KCs); MVP demonstrates the full architecture (statechart + bounded inner agent + mastery rule-gate + transfer probe) on real content. Lessons 3+4 prove extensibility through stretch work. Capstone (the playground) is the demo flex.

**C — MVP = Lessons 1–3; Stretch = Lesson 4 + Playground.** More ambitious MVP. Demonstrates the architecture across the NAND-universality aha moment. Risk: 3 lessons of polished mastery + transfer in 4 weeks is tight; if any lesson is rushed, the mastery rigor (the part of the brief that's hardest to fake) suffers. Polish quality is non-negotiable for this brief — the design bar explicitly rewards taste.

## Decision

**MVP (weeks 1–4):** Lessons 1 and 2 end-to-end.
- Lesson 1: basic operators (AND, OR, NOT). All three representations live. Mastery gate (rule-based + behavioral + transfer probe).
- Lesson 2: composition (combining operators; XOR as composition). All three representations. Mastery gate, with transfer probe that requires recognition of equivalent forms.
- Full statechart with lesson-to-lesson transition rules and held-out-bank transfer probes.
- Bounded inner agent active in both lessons (see [ADR-003](./ADR-003-statechart-plus-bounded-inner-agent.md)).
- Mastery rule-gate, BKT estimate, and behavioral poison flags wired and visible in the demo telemetry.
- One mode of evidence — likely a side-by-side comparison vs. a chat-only baseline — wired up.

**Stretch (weeks 4–6):** Lessons 3 and 4.
- Lesson 3: NAND universality. Same architecture; reuses the same components and inner-agent menu.
- Lesson 4: De Morgan's law. Includes the named "halfway application" misconception in the mastery rubric.
- If stretch is reached, the demo opens on the L1→L4 arc rather than L1→L2.

**Capstone (only if time permits):** Lesson 5 — playground. Free-build mode where the learner proposes a target and the system challenges them to express it across all three representations.

The scope rule for hard cuts: if at week 3 the MVP mastery flow is not demonstrably complete with a working transfer probe, the team cuts stretch content rather than reducing mastery rigor.

## Rationale

The "tightly scoped goal" framing the brief asks for is not about *how many lessons* — it is about *what counts as evidence of mastery*. Our goal is **one**: fluency in Boolean reasoning across three representations. The lessons are a hand-curated difficulty progression within that goal, not five different goals.

That framing survives the CTO question — *"Is this really one goal or five?"* — because the **mastery definition is unchanged across lessons**. The same rule-gate (3 consecutive correct at hardest tier + 0 hints + median response time 2–60s + transfer item pass in held-out representation + explain-back rubric or confidence check) applies at every lesson boundary. The *only* thing that changes between lessons is the difficulty tier and the target representations.

MVP = L1+L2 is the smallest cut that *demonstrates the architecture*:
- Proves the statechart handles inter-lesson transitions (not just intra-lesson phases).
- Proves the inner agent's bounded menu generalises across content.
- Proves the mastery gate triggers in real conditions, not just at the end of a single lesson.
- Proves the transfer probe works at the lesson boundary, where it matters most.

Two lessons also gives us a defensible *recall* moment: in Lesson 2, the inner agent can choose to surface a Lesson-1 KC review item if it detects regression. That demonstrates intra-curriculum memory — a real architectural feature, not a hand-wave.

Cutting stretch rather than mastery rigor is the right tradeoff because the brief is *evaluating the mastery model and the interface judgment*. A 4-lesson prototype with a sloppy mastery gate is a worse submission than a 2-lesson prototype with an airtight one.

## Tradeoffs & risks

- **Smaller MVP than the curriculum implies.** A reader of the submission who only sees the demo may not appreciate the L3+L4 depth without reading the architecture doc. Mitigation: the writeup leads with the full curriculum and labels what was built vs. what is stretch. Demo discipline: open on the curriculum overview, then go deep on L1+L2.
- **L3+L4 may not get built.** If the MVP takes longer than expected, the stretch lessons are cut. The architecture remains defensible because the *abstractions* (statechart, inner agent, mastery gate, transfer bank) generalise; not having the content doesn't invalidate them.
- **The curriculum framing may still read as scope creep to a skeptical reviewer.** Mitigation: the mastery definition is unchanged across lessons; that single sentence is the answer.
- **Lesson 5 (playground) is structurally different** — it is free-build, not directed practice — and may not slot cleanly into the lesson statechart. Treating it as beyond-stretch acknowledges that; if reached, it likely gets its own substate or its own micro-statechart.

## Consequences for the build

- **Weeks 1–2:** Architecture spine: statechart, component library skeleton, content validator, mastery rule-gate. Lesson 1 content. First demo of one full lesson cycle (intro → practice → transfer → mastered).
- **Weeks 2–3:** Lesson 2 content. Inter-lesson transition rules. Inner agent's bounded menu fully active. BKT + behavioral signals wired into the gate. Telemetry visible in the demo.
- **Week 3 checkpoint:** MVP mastery flow demonstrably complete with transfer probe. If not, cut stretch decisively.
- **Weeks 3–4:** Polish; chat-baseline comparison; explain-back voice rubric; writeup begins.
- **Weeks 4–5 (stretch):** Lesson 3 content. Lesson 4 content.
- **Weeks 5–6 (capstone, if reached):** Playground mode.
- **Cross-lesson telemetry** (Lesson 1 KC retention checked during Lesson 2) is an MVP feature, not a stretch feature — it is what proves cross-lesson architectural value.
- **Held-out transfer bank** must be **hand-authored** with enough items to cover all four MVP-and-stretch lessons at planning time, even if stretch lessons are cut. This is a hand-curation tax that has to be paid upfront in week 1.
