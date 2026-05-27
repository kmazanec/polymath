# ADR-001: Use Boolean logic as the learning domain, with mastery defined as fluency across three representations

**Status:** Accepted · **Date:** 2026-05-27 · **Stretch:** no
**Supersedes:** none · **Superseded by:** none

## Context

The brief demands "one tightly scoped learning goal" but is unusually specific about *how* the goal must be defensible: content correctness is non-negotiable, the mastery model must defeat pattern-matching and guessing, and the interface must do pedagogical work that chat alone and static paths can't. The brief lists ten candidate domains (algebra, geometry proofs, SAT reading, AP history, chemistry, physics, vocabulary, foreign language, spatial reasoning, scientific simulations) but invites us to pick our own.

The choice is load-bearing — every later decision (verification stack, manipulable workspace, transfer-probe design, mastery gate) cascades from it. The domain must offer:

- **Deterministic verifiability** — to honor the brief's content-correctness bar
- **A workspace that the domain genuinely *wants*** — not a workspace bolted onto text
- **Cleanly distinct transfer surface-forms** — to make pattern-matching defense structural, not negotiated
- **Citable misconception literature** — to defend the mastery rubric
- **A 90-second demoable arc** — for the evaluating audience

Nerdy is also a constraint: they sell into K-12 and test prep, their Q2 2026 roadmap calls out "4,600+ K-8 math skills mapped to academic taxonomies," and their existing AI Tutor / Maya / Live Learning Platform products already cover chat-with-components and static-path tutoring. Whatever we build can't read as a thinner version of what they ship.

## Options considered

**A — Algebra, one KC (linear equations in one variable).** Highest combined score on the five-axis scorecard. SymPy verifies; misconception lit is enormous (Booth, Koedinger, Filloy & Rojano); maps directly to Nerdy's K-8 math roadmap. Demo risk: algebra is *familiar*, the interface has to earn keep visually.

**B — AP Calculus related rates.** Visually striking (live ladder/balloon simulations); maps to Varsity Tutors' AP-prep DNA. Smaller misconception lit; competes directly with their existing AP Calculus Guided Study Hall product; higher implementation cost.

**C — Physics free-body diagrams.** FBDs are inherently manipulable workspaces; the Force Concept Inventory (Hestenes 1992) gives a 30-year-validated transfer instrument; pairs with phone-handwriting companion. Off Nerdy's roadmap relative to math/test-prep.

**D — Foreign language (e.g., Czech with embedded cultural snippets).** Charming product idea, on Nerdy's "AI language modules" roadmap, but production-language correctness is fuzzy in exactly the way the brief penalizes — LLM-as-judge is the only realistic correctness story, and the brief explicitly lists deterministic checks first.

**E — Algorithmic complexity via physical sorting.** Novel angle; highest demo ceiling; transfer probe ("predict comparisons at 4× size") is the cleanest false-positive defense story across all options. Highest engineering variance — robust camera-based card recognition could absorb a week.

**F — Boolean logic, mastery defined as fluency across symbolic / circuit / pseudocode (chosen).** Three irreducibly different representations of one concept; Boolean equivalence is trivially decidable (truth-table or Z3); transfer is *structural* (the three representations *are* the transfer probes); curriculum arc has a natural "aha" moment (NAND universality) and a deep symmetry to converge on (De Morgan's law). Sits adjacent to Nerdy's portfolio (their All Access Classes include "Python Academy" — CS is on-portfolio) without competing directly with any specific product.

## Decision

The learning domain is **Boolean logic**. The mastery thesis is:

> *Mastery of Boolean reasoning means fluency across three irreducibly different representations of the same concept — symbolic logic expressions, draggable gate circuits, and short pseudocode snippets — verified by a deterministic equivalence check and confirmed by a held-out transfer probe in a representation the learner has not been practicing.*

The curriculum is a progressive arc:

1. **Lesson 1 — Basic operators.** `AND`, `OR`, `NOT`. Three representations introduced from day one.
2. **Lesson 2 — Composition.** Combining operators into expressions; first encounter with "same idea, multiple structures" via XOR-as-composition.
3. **Lesson 3 — NAND universality.** The aha moment: any Boolean function can be built from NAND alone.
4. **Lesson 4 — De Morgan's law.** The deep symmetry that unifies everything earlier; defends against the *named* misconception of "halfway application" (Almstrum 1996).
5. **Lesson 5 — Playground.** Free-build; learner-proposed circuits; system challenges the learner to express their target in all three representations.

**MVP scope is Lessons 1 and 2 end-to-end**, including the full mastery gate and at least one transfer probe. Lessons 3–4 are stretch (architecture proves to extend); Lesson 5 is beyond-stretch demo capstone. See [ADR-002](./ADR-002-curriculum-scope-and-mvp-cut.md).

The product POV in one sentence we will defend:

> *"The interface is the cross-representation gym. Mastery is fluency across representations, and the interface enforces that by being how mastery is measured — not just where it is displayed."*

Inspiration credit: the progression and the "deep symmetry as payoff" pedagogy is informed by Hofstadter's *Gödel, Escher, Bach: An Eternal Golden Braid* (1979) — the canonical pedagogical text on formal systems.

## Rationale

For *this brief* and *this company*, Boolean logic wins on every axis that the brief rewards and the company will respect:

1. **Z3 / truth-table equivalence checking is the strongest verifiability story on the options list.** The brief calls correctness "non-negotiable" and explicitly puts deterministic checks first in its content-validation guidance. We exceed that bar.

2. **Transfer is structural, not designed.** In algebra we have to construct transfer items in different surface forms. In Boolean logic, the three representations *are* the surface forms — and they are irreducible (you cannot collapse "circuit" into "code" without doing the cognitive work the brief is testing). This is a stronger answer to the brief's "design against pattern-matching" requirement than any other domain.

3. **The named misconception literature is real.** Almstrum (1996) catalogues Boolean misconceptions in CS education. De Morgan's "halfway application" (flipping the negation but forgetting to flip the operator) is a well-documented student error we can defend against by name in the mastery rubric.

4. **The "interface as part of the tutoring" thesis becomes literal.** In a Boolean-logic prototype, the interface *is* the assessment — when the learner edits one representation, the others update; when transfer is being measured, the others are hidden. There is no chat-with-charts version of this. The interface is the pedagogy. This is the strongest answer to the brief's "why isn't this just chat" question.

5. **CTO-defense angle for Nerdy specifically.** Dalmia (VP Eng, ex-Amazon/Google) will respect that we picked the domain with the cleanest verification story and the strongest pedagogical literature. Hunigan (VP AI) will recognize the cross-representation thesis as an answer to false-positive mastery that doesn't depend on LLM-as-judge. Cohn (CEO) will see a product extensible into their existing portfolio.

6. **Demo arc is visceral.** A NAND gate lighting up when both inputs flip, while the truth table re-renders and the pseudocode `not (a and b)` highlights, is a satisfying 30-second moment. The transfer probe — "now produce this without the circuit view" — is a satisfying 60-second second moment. The 4-minute lesson arc is achievable.

## Tradeoffs & risks

- **Off Nerdy's explicit Q2 2026 roadmap (which is math-heavy).** Mitigation: CS is on-portfolio via their All Access "Python Academy" listing; the *architecture* is what we're selling, and the architecture extends trivially to algebra or other domains. Frame the domain choice as "the strongest demonstration surface for the architecture, which extends across their portfolio."

- **Audience math-fluency variance.** Some viewers may not have encountered logic gates since intro-CS. Mitigation: the three-representation structure means even a viewer who doesn't follow the symbolic form can follow the circuit form. Demo discipline: don't open on symbolic notation.

- **"Curriculum vs. tightly scoped goal" framing risk.** The brief says "one tightly scoped learning goal" and we are proposing a 5-lesson curriculum. Mitigation: in writeup, frame as "the tightly scoped goal is **mastery of Boolean reasoning across three representations**; the lessons are a hand-curated difficulty progression within one goal, not five separate goals." The mastery definition is *one* — fluency across reps — across all lessons. See [ADR-002](./ADR-002-curriculum-scope-and-mvp-cut.md) for the MVP cut that makes this defensible.

- **The "cross-representation gym" thesis is unproven in the literature.** While multiple-representation pedagogy is well-supported (Ainsworth's DeFT framework, 2006; Goldstone & Son 2005 on concreteness fading), no published study specifically tests *"three irreducibly different representations as the mastery criterion."* We are stating a strong design claim. Mitigation: cite Ainsworth and Goldstone in the writeup; treat the claim as a design hypothesis we are testing with the prototype, not a research finding.

- **Boolean logic is a small win commercially.** Mitigation: this is a take-home, not a product launch. Optimize for the architecture-defense, not the TAM.

## Consequences for the build

- **Content validator** is a Boolean-equivalence checker. SymPy's `sympy.logic` module or the Z3 SMT solver. Likely SymPy for the MVP (no system dependency), Z3 for scale. This becomes the foundation of [Round 6 — content correctness].
- **Curated component library** must include: a `TruthTable` with togglable inputs, a `Circuit` workspace with draggable gates and wires, a `Pseudocode` editor with syntax-highlighted Boolean expressions, a `HintCard`, a `TransferProbe` (hides the other reps), and an `ExplainBack` voice rubric component.
- **Mastery rubric** is rule-gated: 3 consecutive correct across *all three representations* at the lesson's hardest tier + 0 hints on last 3 items + median response time 2–60s + transfer-item passed from a held-out generator in a different representation. This satisfies the maximalist mastery rigor locked earlier.
- **The statechart** must encode the curriculum arc as macro-phases (lesson 1 → lesson 2 → ...) with lesson-internal sub-phases (introducing / practicing / hint / assessed / transferring / mastered). See [ADR-003](./ADR-003-statechart-plus-bounded-inner-agent.md).
- **All later ADRs** (modalities, voice provider, frontend framework, evaluation infra) inherit this domain choice as a constraint.
