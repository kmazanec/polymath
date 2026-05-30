# BRAND.md — Polymath visual system (Nerdy-native, standalone)

> Polymath is a **standalone** tool. It must *feel like* one of Nerdy's learning
> products (Nerdy = parent of Varsity Tutors; closest analog is their free AI
> learning-tools suite at ai.varsitytutors.com) and blend in with that family —
> but it **never references Nerdy or Varsity Tutors directly**. This file is the
> buildable design contract: concrete tokens, the three-modality visual language,
> and the rationale. It supersedes the "low-confidence on exact values" caveats in
> `COMPANY.md` §"Brand & voice" — those values are now pulled from production CSS.

## Where these values came from

Extracted from the **live production CSS** of `nerdy.com`, `varsitytutors.com`, and
`ai.varsitytutors.com` (May 2026). Nerdy ships a *named* brand palette as CSS custom
properties (the `---name` triple-dash convention); the AI-tools suite re-namespaces
the same palette around an indigo/violet primary and adds Geist Mono. Values below are
the brand's, **re-namespaced generically** (no Nerdy/Varsity token names survive).

## The signature, in one paragraph

A screen reads as "this family" when it has: a **deep indigo-navy ink (`#202344`)
as the anchor — never pure black**; **bright cyan (`#17e2ea`)** as the recurring
accent; **Poppins semibold headlines with tight negative tracking** over airy
**Karla** body; **big rounded cards (~20px) and full-pill buttons** with **soft,
indigo-tinted diffuse shadows** and **translucent (alpha) borders** rather than hard
gray lines; **pastel-tint backgrounds + flat vector illustration** (not photography)
on product surfaces; and **springy, quick (.2–.3s) micro-motion**. Four adjectives:
**friendly · vivid · trustworthy · energetic-but-calm.** Playful and colorful enough
to feel encouraging; disciplined (whitespace, indigo restraint, semibold-not-black)
enough to feel "mastery-grade."

## The one "wow" flourish — reserve it

The brand-defining device is a multi-stop **spectrum gradient**
`yellow → pink → purple → cyan`. It appears verbatim on the AI-tools site.
**Reserve it for the mastery-celebration moment** — map our strictest pedagogical
event (declared mastery) to their most recognizable visual peak. Do **not** use it as
chrome.

## The three core modalities — visual language

The pedagogy *is* fluency across three irreducible representations. Make them
**beautiful but not distracting**, each using its commonly-associated shapes.

### One signal color, everywhere
**Green = HIGH / true / correct; muted gray = LOW / false.** The *same* green across
all three surfaces, so "true" looks identical whether it's a truth-table cell, a
glowing wire, or a pseudocode value. Green reads as "current is flowing / on" and
matches the EdTech success semantics (reject red/blue *voltage* coloring — it reads
cold/engineering). Pass/fail must never be hue-only (a11y): pair with glyph/text.

### 1. Truth tables — "a grid of toggles with roles, not a spreadsheet"
- Cells have **three visual roles**, not 16 identical squares: input columns (neutral,
  clickable), the **output/result column tinted green-on-true**, and a focused cell that
  **highlights the cells it depends on in soft blue** ("focusing a row lights up its
  evidence").
- **Two feedback tiers on the same widget, gated by phase**: practicing = cell turns
  green/correct-glyph the instant you enter it; assessed/probe = feedback off. No
  separate scoreboard — feedback lives *in* the cell.
- Toggle-to-type / click-to-toggle, friction-free. MSB-first row order (locked by
  `@polymath/booleans`).

### 2. Logic gates — "true ANSI distinctive shapes, and the bubble means NOT"
- Render gates as the **canonical ANSI distinctive-shape symbols**, not boxes:
  - **AND** — D-shape: flat back, semicircular round front.
  - **OR** — shield/bullet: concave back, sides sweep to a pointed nose.
  - **NOT** — triangle pointing right + small **inversion bubble** at the tip.
  - **NAND** = AND D-shape **+ bubble**; **NOR** = OR shield **+ bubble**.
- Teach the **bubble as a reusable "NOT" stamp** — NAND/NOR are visibly "base gate +
  the same little circle." This is a strong lever for our NAND/NOR lessons (L3/L4).
- **Learner-triggered pulse propagates gate-by-gate along wires**, lighting each gate
  as the signal reaches it (we already have `usePulseRunner`). **Animate only the
  active path.** Green-glow HIGH / muted-gray LOW on the wires. Reduced-motion → static
  step-through (already wired via `data-animate`).
- Calm canvas, generous gate spacing, orthogonal wire routing so the only saturated
  thing on screen is the live signal.

### 3. Pseudocode / expressions — "a friendly notebook, not a terminal"
- Monospace = **Geist Mono** (the on-brand mono of the AI surface) — or JetBrains
  Mono / Fira Code with ligatures as a fallback. **~16px, line-height ~1.5**, generous
  padding, **soft (non-pure-black) theme**, minimal chrome.
- **Syntax-highlight only the load-bearing tokens** (AND/OR/NOT/NAND/NOR, identifiers,
  parens) in a small harmonious palette — a rainbow theme is clutter.
- **Inline correctness as a gentle green line-glow / check beside the line** — never a
  console dump.

### Binding the three together (multiple-linked-representations)
The *links* among representations are the product, not the three panels. Where layout
allows, **one learner action lights the same concept in all three at once** (the AND in
the code, the AND gate in the circuit, the result column in the table pulse the same
color). Give them a hierarchy — one enlarged "active" rep, the others smaller
synchronized "echo" views bound by one shared accent — so they read as **one idea in
three skins**, not three widgets competing.

## Motion budget (unchanged thesis, brand-tuned values)
- Hover/state: **0.2s** `cubic-bezier(.4,0,.2,1)`.
- Mount/reveal: **0.3s** `cubic-bezier(.16,.84,.44,1)` — the brand's signature springy
  ease; aligns with our "hyperresponsive, feels alive" thesis.
- Animate only the thing that just changed / the active path. At most one structural
  change per ~5s. Respect `prefers-reduced-motion` (already enforced).

## Buildable token set (paste-ready, generically named)

```css
:root {
  /* ---- BRAND CORE  [HIGH — from nerdy.com named vars] ---- */
  --color-ink:            #202344;  /* primary dark / brand anchor (navy-indigo) */
  --color-ink-deep:       #20205f;  /* deeper indigo for dark surfaces/headers */
  --color-primary:        #4a4bb6;  /* indigo-violet — AI-product primary (dominant) */
  --color-primary-blue:   #1756e2;  /* royal action blue (alt primary) */
  --color-primary-hover:  #4041c2;
  --color-slate-indigo:   #323661;  /* shadow/gradient mid-tone */

  /* ---- ACCENTS  [HIGH] ---- */
  --color-cyan:           #17e2ea;  /* signature brand accent */
  --color-pink:           #fb43da;
  --color-purple:         #d684ff;
  --color-violet:         #a110ff;
  --color-yellow:         #ffc32b;
  --color-orange:         #ff800d;

  /* ---- SOFT TINTS (illustration / chips / section bg)  [HIGH] ---- */
  --color-tint-blue:      #b8e6ff;
  --color-tint-mint:      #d5f7e4;
  --color-tint-purple:    #a488f7;
  --color-tint-yellow:    #ffeac0;
  --color-lavender-bg:    #efedff;  /* faint cool-white hero background */

  /* ---- NEUTRALS (light)  [HIGH] ---- */
  --color-bg:             #ffffff;
  --color-bg-subtle:      #f4f5ff;  /* lavender-tinted off-white */
  --color-surface:        #ffffff;
  --color-surface-muted:  #ececf0;
  --color-input-bg:       #f3f3f5;
  --color-text:           #202344;  /* body = ink, not pure black */
  --color-text-muted:     #717182;
  --color-border:         rgba(0,0,0,0.10);          /* translucent, not solid gray */
  --color-ring:           rgba(125,135,255,0.50);

  /* ---- NEUTRALS (dark)  [HIGH] ---- */
  --color-bg-dark:          #0f1228;
  --color-surface-dark:     #181a2e;
  --color-text-dark:        #f1f5ff;
  --color-text-dark-muted:  #c3ceff;

  /* ---- SEMANTIC  [HIGH] — note green=HIGH/correct is the signal color ---- */
  --color-success:        #35dd8b;  /* mint — HIGH / true / correct */
  --color-success-strong: #10b981;
  --color-warning:        #ffc32b;
  --color-error:          #d4183d;

  /* ---- SIGNATURE GRADIENT  [HIGH — reserve for mastery] ---- */
  --gradient-spectrum: linear-gradient(89deg,
      #ffc32b 15%, #fb43da 45%, #f848dd 49.99%, #d684ff 65%, #17e2ea 75%);
  --gradient-primary:  linear-gradient(14deg, #4a4bb6, #5376ff);

  /* ---- TYPOGRAPHY  [HIGH] ---- */
  --font-display: "Poppins", system-ui, sans-serif;   /* headings, semibold 600 */
  --font-body:    "Karla", system-ui, sans-serif;
  --font-mono:    "Geist Mono", ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
  --tracking-display: -0.045em;   /* tight negative tracking on large Poppins */
  --leading-body:     1.5;

  /* ---- RADIUS  [HIGH] ---- */
  --radius-xs:    4px;        /* chips / inputs */
  --radius-sm:    0.5rem;     /* 8px */
  --radius-md:    0.75rem;    /* 12px */
  --radius-card:  1.25rem;    /* 20px — DEFAULT card radius */
  --radius-lg:    1.5rem;     /* 24px — feature cards */
  --radius-pill:  9999px;     /* buttons / pills (default CTA shape) */

  /* ---- SHADOWS (soft, indigo-tinted)  [HIGH] ---- */
  --shadow-sm:    0 2px 8px rgba(50,54,97,0.07);
  --shadow-card:  0 4px 20px rgba(50,54,97,0.15), 0 2px 10px rgba(50,54,97,0.10);
  --shadow-lift:  0 8px 32px rgba(31,38,135,0.15);
  --glow-success: 0 0 10px rgba(16,185,129,0.30);    /* HIGH/correct glow */

  /* ---- MOTION  [HIGH] ---- */
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring:  cubic-bezier(0.16, 0.84, 0.44, 1);  /* signature reveal */
  --dur-hover:    0.2s;
  --dur-reveal:   0.3s;
}
```

## Build notes specific to Polymath
- **Primary = `#4a4bb6`** (cold-purple indigo) — the dominant color of their AI product,
  the closest analog to our tool. Use `#1756e2` for the brighter "marketing" CTA feel.
- **Geist Mono** for pseudocode/circuit labels ties the "fluent across representations"
  thesis to the on-brand technical typeface.
- Borders → **translucent rings + soft indigo shadows**, never 1px solid gray.
- **Spectrum gradient → mastery celebration only.**
- Keep WCAG 2.1 AA contrast and deuteranopia-safety the existing tokens already enforce
  (`tokenContrast.test.ts`): pass/fail never hue-only — always glyph/text + color.

## Anti-patterns to avoid (would make it feel cold/techy/cluttered)
- Many saturated colors competing → one accent carries meaning, rest neutral.
- Everything animating at once → animate only the active path / last change.
- Cramped, textbook-dense layout → whitespace makes even data-heavy pages feel light.
- Red/blue voltage colors, pure-black IDE, 12px mono → warm success-green, soft theme,
  larger friendly type.
- Separate score/error panels → feedback lives *in* the element, instantly.

## Sources
Production CSS: `nerdy.com /_next/static/css/d117efeb75475c12.css` (named brand palette);
`ai.varsitytutors.com /_next/static/css/15201774f5428d88.css`, `209d7d13c48f0391.css`
(AI-product tokens, Geist/Geist Mono); `varsitytutors.com` homepage CSS. Modality
patterns: UT Austin Truth Table App (dependency-blue), iLogic (green output column),
ANSI/IEEE Std 91-1984 distinctive-shape symbols, Logicly/CircuitVerse/EveryCircuit
(signal-color + step-through propagation), Fira Code/JetBrains Mono ligatures, the
multiple-linked-representations literature, Duolingo microinteraction model.
