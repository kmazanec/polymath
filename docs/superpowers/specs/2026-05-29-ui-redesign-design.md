# Polymath UI redesign — design spec

**Date:** 2026-05-29 · **Status:** direction approved — ready for implementation plan
**Companions:** `docs/BRAND.md` (the buildable token set + rationale),
`docs/design-prototypes/index.html` (the working visual prototype).

## Goal

Make Polymath *look like a Nerdy learning product* (the AI-tools-suite family) without
ever referencing Nerdy/Varsity, and make the three core modalities — **truth table,
gate circuit, code editor** — beautiful but not distracting, each rendered with its
commonly-associated shapes and visual metaphors. The architecture, contracts, and
pedagogy are untouched; this is a presentation-layer redesign.

## Decisions locked with the user

1. **Hero theme: light / airy.** Near-white lavender-tinted canvas, indigo ink text.
   Dark mode stays supported (it already is) but light is the designed-for experience.
2. **Scope: the three modalities + the lesson shell** (header/progress, workspace, hint
   slot, ask/voice bar, buttons, mastery moment) — one cohesive language top to bottom.
   *Not* in scope this pass: rethinking the moment-to-moment UX flow (multi-rep linked
   layout, onboarding, phase transitions) — a possible later pass.
3. **Truth table variant: B (Row pills)** — each row is one tactile lozenge with an
   arrow to the clickable output cell. (A bit-chips and C signal-grid stay in the proto
   as reference only.)
4. **Web fonts: self-hosted** — Poppins, Karla, JetBrains Mono bundled into `apps/web`
   (no Google Fonts CDN). Production-grade, offline-safe, privacy-safe for the K-12
   institutional motion, and avoids font-swap layout shift.

## The aesthetic direction (validated in the prototype)

A **warm, light, indigo-grounded learning lab**, where:

- The brand anchor is deep indigo-navy `#202344` — never pure black. Primary action is
  indigo `#4a4bb6` (the AI-product primary). Display type is **Poppins semibold** with
  tight negative tracking; body is **Karla**; code is **JetBrains Mono / Geist Mono**.
- **One signal color carries meaning: green (`#14c98a`) = HIGH / true / correct**, the
  *only* saturated color, used identically across all three modalities. LOW/false is a
  muted gray; not-yet-equivalent is warm orange-red — never hue-only (always glyph+text,
  preserving the existing deuteranopia-safe + WCAG-AA guarantees).
- Cards are ~20px-radius on soft, indigo-tinted diffuse shadows with translucent
  (alpha) borders — never hard 1px gray lines. Buttons are full pills.
- Motion is the brand's springy `cubic-bezier(.16,.84,.44,1)` at .2–.3s, only on the
  thing that just changed. Reduced-motion already enforced.
- The signature **spectrum gradient** (yellow→pink→purple→cyan) is reserved for **one**
  moment: the mastery celebration. Earned, never chrome.

## The three modalities

### Truth table — "a grid of toggles with roles, not a spreadsheet"
- Input bits are circular chips (filled green = 1, muted = 0); the **output column is
  the only clickable surface and the only place green appears**.
- Focusing a row **lights the cells it depends on in soft blue** ("the evidence").
- Two feedback tiers on the *same* widget, gated by phase: practicing = instant
  green-glow + ✓; assessed/probe = feedback off. No separate scoreboard.
- **Chosen variant: B (row pills).** Each row is one tactile lozenge — inputs as a chip
  cluster, an arrow, then the clickable output cell — the most "alive" of the three.
  Same bit-chip + output-cell + focus-evidence mechanics; just laid out as a row of
  pills rather than a `<table>`. (A and C remain in the proto as reference.)

### Gate circuit — "true ANSI shapes, and the bubble means NOT"
- Gates render as **canonical ANSI distinctive shapes** in SVG: AND = D, OR = pointed
  shield, NOT = triangle + inversion **bubble**. NAND = AND + bubble; NOR = OR + bubble.
- The bubble is one reusable "invert" token — NAND/NOR read as "the gate you know,
  stamped" — directly serving lessons 3 & 4.
- Calm dotted canvas; palette drops real gate shapes; wires carry the signal color.
  The **learner-triggered pulse flows gate-by-gate** (we already have `usePulseRunner`),
  green-glow on the active path only. (Replaces react-flow's default white boxes.)

### Code editor — "a friendly notebook, not a terminal"
- JetBrains Mono / Geist Mono, ~16px / 1.5 line-height, generous padding, soft theme,
  minimal chrome. Only load-bearing tokens colored (operators, identifiers, parens).
- Correctness = **gentle green line-glow + ✓ beside the line**, never a console dump.
- Light is the hero; an optional dark editor variant exists in the proto.

## The shell
Progress-aware header (phase chip + step dots), lesson framing, a **non-destructive hint
that sits beside the work** (yellow-tinted aside, matching the existing hint-ladder
levels), and a combined ask/voice bar (text + mic in one pill). Mastery moment uses the
spectrum gradient.

## What this maps to in code (implementation pass, not this spec)
- Rewrite `apps/web/src/styles/tokens.css` + `global.css` to the BRAND.md token set
  (the existing token *names* are largely reused, so view-scoped CSS keeps working).
- Component-level restyle of `TruthTable.tsx`, `CircuitBuilder.tsx` + `circuitNodes.tsx`
  (the ANSI SVG shapes replace the default react-flow boxes), `PseudocodeChallenge.tsx`
  (CM6 theme), plus the shell in `App.tsx` and the side slots.
- All locked contracts, the registry switch, a11y guarantees, and `visibleReps` gating
  are preserved. No `ComponentSpec` kinds added.

## Resolved
- Web fonts: **self-hosted** (no CDN).
- Truth-table variant: **B (row pills)** is final; A/C are reference only.
- Editor: **light is the hero**; the dark editor variant is reference, not v1 scope
  (the app's existing `prefers-color-scheme: dark` support continues to apply).
