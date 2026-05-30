# Polymath UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the Polymath web app to a Nerdy-native, light/airy "learning lab" look — self-hosted Poppins/Karla/JetBrains Mono, one signal-green for "true/correct", ANSI gate shapes, row-pill truth table, friendly code editor, and a polished lesson shell — without touching any locked contract, component kind, or pedagogy.

**Architecture:** Presentation-layer only. Rewrite the two global stylesheets (`tokens.css`, `global.css`) to the `docs/BRAND.md` token set, **keeping the existing token NAMES** (`--color-bg`, `--color-surface`, `--color-pass/fail/warn`, `--color-accent`, etc.) so view-scoped CSS and `tokenContrast.test.ts` keep working. Add scoped CSS + minor JSX (extra wrapper elements, SVG gate shapes, icons) to the three modality components and the shell — **preserving every existing role, `aria-*`, `data-*`, accessible name, and `className` the tests assert on**. The visual change is CSS + additive markup, never a DOM teardown.

**Tech Stack:** React 19, Vite 6, TypeScript (strict, ESM `.js` imports), CSS custom properties, `@xyflow/react` (circuit), CodeMirror 6 (pseudocode), Vitest + Testing Library + jest-axe.

---

## Non-negotiable constraints (read before any task)

These are the traps that will red the build if violated:

1. **Token NAMES are an API.** `apps/web/src/styles/tokenContrast.test.ts` parses `tokens.css` and asserts `--color-pass`, `--color-fail`, `--color-warn` each clear **4.5:1 AA** contrast against **both** `--color-bg` and `--color-surface`, in **both** the `:root` (light) and `@media (prefers-color-scheme: dark)` blocks. So:
   - Keep these exact token names defined in `tokens.css`.
   - The text-green `--color-pass` must be an **AA-passing** green on white/light surfaces. `#0a9e6c` ≈ 4.5:1 on `#ffffff` — verify in Task 2's test. The brighter `#14c98a` from the prototype is a **fill/glow** color only (new token `--color-signal`), never used as text on light.
2. **TruthTable keeps `<table>` semantics.** `TruthTable.test.tsx` (400 lines) calls `getAllByRole('row')` (expects header row + 2^n data rows), filters output buttons by `aria-pressed`, and finds the submit by accessible name `/submit/i`, plus `role="alert"` on the var-cap error. The "row pills" look is achieved with **CSS on the existing table DOM** (`display` overrides) — do **not** convert `<table>/<tr>/<td>` to `<div>`s.
3. **CircuitBuilder keeps button names + attrs.** `CircuitBuilder.test.tsx` finds `getByRole('button', { name: /Add AND gate/i })` (and OR/NOT/NAND), `data-gate` attributes, and the texts `Test it` / `Submit` / `Next gate →`. Icons go **inside** these buttons; their accessible names and `data-gate` stay exactly as-is.
4. **PseudocodeChallenge keeps its seams.** `PseudocodeChallenge.test.tsx` drives `data-testid="source-input"`, the `role="region"`, the `aria-labelledby` heading, `role="alert"`/`role="status"` on feedback, and a `/submit/i` button. Theme via CodeMirror's `EditorView.theme(...)`; don't remove the hidden sync input or the labelled region.
5. **No new `ComponentSpec` kinds, no contract edits, no `@polymath/booleans` signature changes.** This is `apps/web` only (plus `apps/web/public`, `apps/web/index.html`).
6. **a11y + reduced-motion preserved.** `a11y.axe.test.tsx` runs jest-axe; keep focus rings, the `.visually-hidden` util, the `[data-animate='false']` / `prefers-reduced-motion` blocks, and never make pass/fail hue-only (always glyph/text + color).
7. **Run the web suite in isolation** per CLAUDE.md: `pnpm --filter @polymath/web test`. A flaky *full* `pnpm test` (shared test-pg) is not a gating failure here; the web project owns no DB.

---

## File Structure

**Create:**
- `apps/web/public/fonts/` — self-hosted woff2 files (Poppins 400/500/600/700, Karla 400/500/600/700, JetBrains Mono 400/500/600).
- `apps/web/src/styles/fonts.css` — the `@font-face` block, imported first.
- `apps/web/src/styles/circuit.css` — scoped CSS for the circuit palette/canvas/controls/gate nodes (replaces today's inline styles in `circuitNodes.tsx`).
- `apps/web/src/components/gateShapes.tsx` — the ANSI gate-shape SVG components (AND/OR/NOT/NAND/NOR), reused by `circuitNodes.tsx` and the palette.

**Modify:**
- `apps/web/src/styles/tokens.css` — rewrite values to BRAND.md, keep names, add new additive tokens (`--color-signal`, `--font-display`, `--font-mono`, radii, shadows, motion).
- `apps/web/src/styles/global.css` — restyle base/buttons/cards/hint/ask-bar/truth-table/celebration using the tokens; import `fonts.css` + `circuit.css`.
- `apps/web/src/components/TruthTable.tsx` — add row-pill wrappers/classNames + bit-chip spans (table DOM unchanged).
- `apps/web/src/components/circuitNodes.tsx` — render real ANSI gate shapes; move inline styles to `circuit.css` classNames.
- `apps/web/src/components/CircuitBuilder.tsx` — palette buttons get gate-shape icons; keep names/attrs; add classNames already referenced (`circuit-palette`, etc.).
- `apps/web/src/components/PseudocodeChallenge.tsx` — CodeMirror theme + token highlight colors via tokens; inline-glow correctness styling.
- `apps/web/src/components/MasteryCelebration.tsx` — spectrum-gradient treatment.
- `apps/web/src/App.tsx` — lesson shell: header/progress, lesson-title block, ask/voice bar layout (additive classNames + small markup; handlers unchanged).
- `apps/web/index.html` — `<link rel="preload">` the two most-used font files; set a base background to avoid FOUC.

**Each task is independently committable and leaves the web suite green.**

---

## Task 1: Self-host the fonts

**Files:**
- Create: `apps/web/public/fonts/*.woff2`
- Create: `apps/web/src/styles/fonts.css`
- Modify: `apps/web/index.html`

- [ ] **Step 1: Download the woff2 files into `public/fonts/`**

Run (from repo root):
```bash
cd apps/web && mkdir -p public/fonts && cd public/fonts
# Poppins (latin) 400/500/600/700, Karla 400/500/600/700, JetBrains Mono 400/500/600.
# Pull from the google-webfonts-helper API (returns direct woff2 URLs, no CDN at runtime):
for f in \
  "poppins:400,500,600,700" \
  "karla:400,500,600,700" \
  "jetbrains-mono:400,500,600"; do
  fam="${f%%:*}"; wts="${f##*:}"
  curl -s "https://gwfh.mranftl.com/api/fonts/${fam}?subsets=latin" \
    | python3 -c "import sys,json,urllib.request as u;d=json.load(sys.stdin);
import os
wts='${wts}'.split(',')
for v in d['variants']:
    if v['fontWeight'] in wts and v.get('fontStyle')=='normal':
        url=v['woff2']; fn=f\"{d['id']}-{v['fontWeight']}.woff2\"; u.urlretrieve(url, fn); print('saved', fn)"
done
ls -la
```
Expected: 11 `.woff2` files (e.g. `poppins-600.woff2`, `karla-400.woff2`, `jetbrains-mono-500.woff2`).

> If the helper API is unreachable in the build env, fall back to fetching each weight from `https://fonts.gstatic.com` URLs listed by `https://fonts.googleapis.com/css2?family=...` (download once, commit the files — the runtime stays CDN-free).

- [ ] **Step 2: Write `fonts.css` with `@font-face` (font-display: swap)**

Create `apps/web/src/styles/fonts.css`:
```css
/* Self-hosted brand fonts. No runtime CDN (privacy-safe for K-12). */
@font-face { font-family: 'Poppins'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/poppins-400.woff2') format('woff2'); }
@font-face { font-family: 'Poppins'; font-style: normal; font-weight: 500; font-display: swap; src: url('/fonts/poppins-500.woff2') format('woff2'); }
@font-face { font-family: 'Poppins'; font-style: normal; font-weight: 600; font-display: swap; src: url('/fonts/poppins-600.woff2') format('woff2'); }
@font-face { font-family: 'Poppins'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/poppins-700.woff2') format('woff2'); }
@font-face { font-family: 'Karla'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/karla-400.woff2') format('woff2'); }
@font-face { font-family: 'Karla'; font-style: normal; font-weight: 500; font-display: swap; src: url('/fonts/karla-500.woff2') format('woff2'); }
@font-face { font-family: 'Karla'; font-style: normal; font-weight: 600; font-display: swap; src: url('/fonts/karla-600.woff2') format('woff2'); }
@font-face { font-family: 'Karla'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/karla-700.woff2') format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/jetbrains-mono-400.woff2') format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 500; font-display: swap; src: url('/fonts/jetbrains-mono-500.woff2') format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 600; font-display: swap; src: url('/fonts/jetbrains-mono-600.woff2') format('woff2'); }
```

- [ ] **Step 3: Preload the two hero weights in `index.html`**

In `apps/web/index.html`, add inside `<head>` (after the viewport meta):
```html
<link rel="preload" href="/fonts/poppins-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/karla-400.woff2" as="font" type="font/woff2" crossorigin>
```

- [ ] **Step 4: Verify the dev server serves the fonts**

Run:
```bash
cd /Users/keith/dev/gauntlet/nerdy/polymath && pnpm --filter @polymath/web dev &
sleep 5 && curl -sI http://localhost:5173/fonts/poppins-600.woff2 | head -1 && curl -sI http://localhost:5173/fonts/karla-400.woff2 | head -1
lsof -ti:5173 | xargs kill
```
Expected: `HTTP/1.1 200 OK` for both.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/fonts apps/web/src/styles/fonts.css apps/web/index.html
git commit -m "feat(web): self-host brand fonts (Poppins/Karla/JetBrains Mono)"
```

---

## Task 2: Rewrite design tokens (keep names, AA-safe signal green)

**Files:**
- Modify: `apps/web/src/styles/tokens.css`
- Test: `apps/web/src/styles/tokenContrast.test.ts` (existing — must stay green)

- [ ] **Step 1: Run the existing contrast test to capture the baseline (green now)**

Run: `pnpm --filter @polymath/web exec vitest run src/styles/tokenContrast.test.ts`
Expected: PASS (current tokens already clear AA).

- [ ] **Step 2: Rewrite `tokens.css` — new values, SAME status/surface names + additive tokens**

Replace the body of `apps/web/src/styles/tokens.css` (keep the file's header comment intent). Light `:root`:
```css
:root {
  /* Surfaces / text */
  --color-bg: #f7f8fe;          /* lavender-tinted off-white hero */
  --color-surface: #ffffff;
  --color-surface-muted: #f3f3f8;
  --color-text: #202344;        /* ink, not pure black */
  --color-text-muted: #6b6f8a;
  --color-border: rgba(32,35,68,0.10);

  /* Accent + brand */
  --color-accent: #4a4bb6;      /* indigo primary (was #1d4ed8) */
  --color-accent-blue: #1756e2;
  --color-accent-hover: #4041c2;
  --color-ink: #202344;
  --color-cyan: #17e2ea;

  /* Status — AA-verified text colours. pass=green (signal), fail=orange, warn=amber.
     NOTE: pass is a DEEP green so it clears 4.5:1 as TEXT on white+surface. The brighter
     fill/glow green is --color-signal below (used only for fills/borders/shadows). */
  --color-pass: #0a8f63;        /* deep signal-green; AA text on #fff and #f7f8fe */
  --color-fail: #b3500a;        /* unchanged family — AA on bg+surface (guarded) */
  --color-warn: #8a6d00;        /* unchanged */

  /* Signal fill/glow (NOT text) — green = HIGH/true/correct everywhere */
  --color-signal: #14c98a;
  --color-signal-tint: #e2faf1;
  --color-signal-glow: rgba(20,201,138,0.35);
  --color-low: #c2c6d8;
  --color-low-tint: #eef0f6;

  /* Focus ring */
  --color-focus: #4a4bb6;

  /* Tints */
  --color-lavender: #f4f5ff;
  --color-tint-yellow: #ffeac0;

  /* Signature gradient — RESERVE for mastery */
  --gradient-spectrum: linear-gradient(100deg, #ffc32b 8%, #fb43da 38%, #d684ff 62%, #17e2ea 88%);
  --gradient-primary: linear-gradient(135deg, #4a4bb6, #5376ff);

  /* Type */
  --font-display: 'Poppins', system-ui, -apple-system, sans-serif;
  --font-body: 'Karla', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --tracking-display: -0.03em;

  /* Spacing + radius */
  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 1rem; --space-4: 1.5rem;
  --radius-1: 0.625rem; --radius-2: 1.25rem; --radius-pill: 9999px;

  /* Shadow + motion */
  --shadow-card: 0 6px 24px rgba(50,54,97,0.10), 0 1px 3px rgba(50,54,97,0.06);
  --shadow-sm: 0 2px 8px rgba(50,54,97,0.06);
  --ease-spring: cubic-bezier(0.16,0.84,0.44,1);
  --dur-hover: 0.18s; --dur-reveal: 0.32s;
}
```
Dark block — keep `@media (prefers-color-scheme: dark)` and override the same status/surface names with AA-safe dark values:
```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0f1228;
    --color-surface: #181a2e;
    --color-surface-muted: #1f2238;
    --color-text: #f1f5ff;
    --color-text-muted: #aab3c2;
    --color-border: rgba(255,255,255,0.12);

    --color-accent: #8b8cf0;
    --color-accent-hover: #a3a4ff;
    --color-cyan: #17e2ea;

    --color-pass: #4fd6a0;       /* AA on dark bg+surface */
    --color-fail: #f0954a;       /* unchanged family */
    --color-warn: #d6b94a;
    --color-signal: #2fe3a3;
    --color-signal-tint: rgba(47,227,163,0.16);
    --color-signal-glow: rgba(47,227,163,0.40);
    --color-low: #3a4150;
    --color-low-tint: #232838;
    --color-focus: #8b8cf0;
    --color-lavender: #1b1f3a;
  }
}
```

- [ ] **Step 3: Run the contrast test — must still pass**

Run: `pnpm --filter @polymath/web exec vitest run src/styles/tokenContrast.test.ts`
Expected: PASS. If `--color-pass` fails on either surface, deepen it (e.g. `#0a8159`) until ≥4.5:1, then re-run. Do not lighten it.

- [ ] **Step 4: Run the full web suite (nothing else should break from token values)**

Run: `pnpm --filter @polymath/web test`
Expected: PASS (token *names* unchanged, so consuming CSS still resolves).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles/tokens.css
git commit -m "feat(web): rebrand design tokens (indigo + signal-green, AA-safe)"
```

---

## Task 3: Restyle the global stylesheet (base, buttons, cards, hint, ask-bar)

**Files:**
- Modify: `apps/web/src/styles/global.css`
- Test: `apps/web/src/a11y.axe.test.tsx` (existing — must stay green)

- [ ] **Step 1: Import fonts + circuit CSS at the top of `global.css`**

At the very top of `apps/web/src/styles/global.css`, before `@import './tokens.css';`:
```css
@import './fonts.css';
```
And after the tokens import add:
```css
@import './circuit.css';
```
(`circuit.css` is created in Task 5; add the import now — create a stub `apps/web/src/styles/circuit.css` containing only `/* circuit styles — filled in Task 5 */` in this same step so the `@import` resolves and Task 3 stays green.)

- [ ] **Step 2: Set the atmospheric background + display type on `body`/headings**

Replace the `body { ... }` rule in `global.css` with:
```css
body {
  margin: 0;
  background: var(--color-bg);
  background-image:
    radial-gradient(1200px 700px at -10% -15%, #ece9ff 0%, transparent 55%),
    radial-gradient(1000px 700px at 110% 115%, #e3fbff 0%, transparent 55%);
  background-attachment: fixed;
  color: var(--color-text);
  font-family: var(--font-body);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4 { font-family: var(--font-display); font-weight: 600; letter-spacing: var(--tracking-display); color: var(--color-ink); }
```
(In the dark block via tokens the radial tints read too bright — wrap them: add `@media (prefers-color-scheme: dark) { body { background-image: none; } }` at the end of `global.css`.)

- [ ] **Step 3: Restyle cards, buttons, hint, ask-bar using tokens**

Update the existing BEM baseline block. Cards (`.lesson-intro, .hint-card, …, .truth-table`) → `border-radius: var(--radius-2); box-shadow: var(--shadow-card); border: 1px solid var(--color-border); background: var(--color-surface);`. Buttons (`.continue-to-next-lesson, .hint-button, .truth-table-submit, .ask-agent button`) → pill shape, indigo fill, spring hover:
```css
.continue-to-next-lesson, .hint-button, .truth-table-submit, .ask-agent button {
  font-family: var(--font-display); font-weight: 600;
  padding: 0.62rem 1.3rem; border: none; border-radius: var(--radius-pill);
  background: var(--color-accent); color: #fff; cursor: pointer;
  box-shadow: 0 6px 18px rgba(74,75,182,0.30);
  transition: transform var(--dur-hover) var(--ease-spring), background var(--dur-hover);
}
.continue-to-next-lesson:hover, .hint-button:hover, .truth-table-submit:hover, .ask-agent button:hover {
  transform: translateY(-2px); background: var(--color-accent-hover);
}
```
Hint levels keep the left-border ladder but use the warm tint: `.hint-card { background: var(--color-tint-yellow); border-left-width: 4px; }` and keep the `--level-N` border colors mapped to `--color-border / --color-accent / --color-warn`. Ask-bar (`.ask-agent`) → pill container with inset ring: `border-radius: var(--radius-pill); background: var(--color-surface-muted); box-shadow: inset 0 0 0 1px var(--color-border); padding: 0.5rem 0.5rem 0.5rem 1rem;` and `.ask-agent input { background: transparent; border: none; }`.

> Keep the `.status-pass`/`.status-fail` glyph rules, the `[data-verdict=...]` cell rules, `.visually-hidden`, `:focus-visible`, the `@media print` reset, and BOTH reduced-motion blocks **exactly as they are** (only swap any hard-coded hexes for the token equivalents).

- [ ] **Step 4: Run the a11y + full web suite**

Run: `pnpm --filter @polymath/web test`
Expected: PASS (axe finds no contrast/role regressions; focus ring intact).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles/global.css apps/web/src/styles/circuit.css
git commit -m "feat(web): restyle global chrome (cards, pill buttons, hint, ask-bar)"
```

---

## Task 4: Truth table — row pills (CSS + bit chips, table DOM preserved)

**Files:**
- Modify: `apps/web/src/components/TruthTable.tsx`
- Modify: `apps/web/src/styles/global.css`
- Test: `apps/web/src/components/TruthTable.test.tsx` (existing — must stay green)

- [ ] **Step 1: Run the existing TruthTable tests (baseline green)**

Run: `pnpm --filter @polymath/web exec vitest run src/components/TruthTable.test.tsx`
Expected: PASS.

- [ ] **Step 2: Wrap input cells in bit-chip spans (DOM roles unchanged)**

In `TruthTable.tsx`, the input cell currently renders `<td key={colIdx}>{val ? '1' : '0'}</td>`. Change the child to a styled span (the `<td>` stays):
```tsx
<td key={colIdx}>
  <span className={`tt-bit ${val ? 'tt-bit--on' : 'tt-bit--off'}`}>{val ? '1' : '0'}</span>
</td>
```
Add an `tt-arrow` marker cell is **not** needed (keep column count stable for the tests). The output `<button>` stays exactly as-is (class, `aria-pressed`, `data-verdict`).

- [ ] **Step 3: Add the row-pill CSS to `global.css`**

Append to `global.css`:
```css
/* Truth table — row-pill presentation over the existing <table> DOM. */
.truth-table table { border-collapse: separate; border-spacing: 0 0.5rem; width: 100%; }
.truth-table thead th { font-family: var(--font-body); font-size: 0.72rem; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--color-text-muted); font-weight: 600; padding-bottom: 0.25rem; }
.truth-table thead th:last-child { color: var(--color-pass); }
.truth-table tbody tr { background: var(--color-surface-muted); border-radius: var(--radius-pill); }
.truth-table tbody td { padding: 0.35rem 0.4rem; }
.truth-table tbody td:first-child { border-radius: var(--radius-pill) 0 0 var(--radius-pill); padding-left: 0.6rem; }
.truth-table tbody td:last-child { border-radius: 0 var(--radius-pill) var(--radius-pill) 0; padding-right: 0.6rem; }
.tt-bit { display: inline-flex; align-items: center; justify-content: center; width: 2.1rem; height: 2.1rem;
  border-radius: 50%; font-family: var(--font-mono); font-weight: 600; }
.tt-bit--on { background: var(--color-signal-tint); color: var(--color-pass); box-shadow: inset 0 0 0 1.5px var(--color-signal); }
.tt-bit--off { background: var(--color-low-tint); color: var(--color-text-muted); box-shadow: inset 0 0 0 1.5px var(--color-border); }
.truth-table-output-cell { width: 2.4rem; height: 2.4rem; border-radius: var(--radius-pill); border: none;
  font-family: var(--font-mono); font-weight: 700; cursor: pointer; background: var(--color-surface);
  color: var(--color-text-muted); box-shadow: inset 0 0 0 1.5px var(--color-border);
  transition: transform var(--dur-hover) var(--ease-spring); }
.truth-table-output-cell:hover { transform: translateY(-1px); }
.truth-table-output-cell[aria-pressed='true'] { background: var(--color-signal-tint); color: var(--color-pass);
  box-shadow: inset 0 0 0 2px var(--color-signal), 0 0 0 4px var(--color-signal-glow); }
```
(The post-submit `.verdict-correct/.verdict-incorrect` glyph+ring rules already exist in global.css and keep working — they layer the ✓/✗ + AA color over the pressed state.)

- [ ] **Step 4: Run the TruthTable tests (still green — DOM unchanged)**

Run: `pnpm --filter @polymath/web exec vitest run src/components/TruthTable.test.tsx`
Expected: PASS (rows, `aria-pressed`, submit name, alert all intact).

- [ ] **Step 5: Visual check (manual, optional but recommended)**

Run the dev server, drive a session (or temporarily mount via a throwaway route), confirm the row-pills + green output read correctly. Remove any throwaway before commit.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/TruthTable.tsx apps/web/src/styles/global.css
git commit -m "feat(web): truth table row-pill look with signal-green output"
```

---

## Task 5: ANSI gate shapes + circuit canvas styling

**Files:**
- Create: `apps/web/src/components/gateShapes.tsx`
- Modify: `apps/web/src/components/circuitNodes.tsx`
- Modify: `apps/web/src/components/CircuitBuilder.tsx`
- Modify: `apps/web/src/styles/circuit.css` (stub from Task 3 → real content)
- Test: `apps/web/src/components/CircuitBuilder.test.tsx`, `apps/web/src/components/circuitNodes` (via CircuitBuilder), and a new `gateShapes.test.tsx`

- [ ] **Step 1: Write a failing test for `gateShapes`**

Create `apps/web/src/components/gateShapes.test.tsx`:
```tsx
import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { GateShape } from './gateShapes.js';

afterEach(() => cleanup());

describe('GateShape', () => {
  it('renders an svg with the gate kind as a data attribute', () => {
    const { container } = render(<GateShape kind="AND" />);
    const svg = container.querySelector('svg[data-gate-shape="AND"]');
    expect(svg).toBeTruthy();
  });
  it('renders an inversion bubble for NAND/NOR/NOT but not AND/OR', () => {
    for (const k of ['NOT', 'NAND', 'NOR'] as const) {
      const { container } = render(<GateShape kind={k} />);
      expect(container.querySelector('[data-bubble]'), `${k} has bubble`).toBeTruthy();
      cleanup();
    }
    for (const k of ['AND', 'OR'] as const) {
      const { container } = render(<GateShape kind={k} />);
      expect(container.querySelector('[data-bubble]'), `${k} no bubble`).toBeNull();
      cleanup();
    }
  });
  it('marks the body live when live=true', () => {
    const { container } = render(<GateShape kind="AND" live />);
    expect(container.querySelector('[data-live="true"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it — fails (module missing)**

Run: `pnpm --filter @polymath/web exec vitest run src/components/gateShapes.test.tsx`
Expected: FAIL ("Cannot find module './gateShapes.js'").

- [ ] **Step 3: Implement `gateShapes.tsx`**

Create `apps/web/src/components/gateShapes.tsx`:
```tsx
import type { ReactElement } from 'react';

export type GateShapeKind = 'AND' | 'OR' | 'NOT' | 'NAND' | 'NOR';

/** Canonical ANSI distinctive-shape gate symbols. Drawn in a 100x70 viewBox.
 *  The inversion bubble (a small circle at the output) is the reusable "NOT" token:
 *  NAND = AND + bubble, NOR = OR + bubble, NOT = triangle + bubble. */
function bodyPath(kind: GateShapeKind): string {
  switch (kind) {
    case 'AND':  return 'M18 8 H48 A27 27 0 0 1 48 62 H18 Z';
    case 'NAND': return 'M18 8 H44 A27 27 0 0 1 44 62 H18 Z';
    case 'OR':   return 'M16 8 Q40 35 16 62 Q52 62 80 35 Q52 8 16 8 Z';
    case 'NOR':  return 'M16 8 Q40 35 16 62 Q50 62 76 35 Q50 8 16 8 Z';
    case 'NOT':  return 'M20 8 L20 62 L70 35 Z';
  }
}
function bubbleCx(kind: GateShapeKind): number | null {
  switch (kind) { case 'NOT': return 76; case 'NAND': return 78; case 'NOR': return 84; default: return null; }
}

export function GateShape({ kind, live = false }: { kind: GateShapeKind; live?: boolean }): ReactElement {
  const cx = bubbleCx(kind);
  return (
    <svg viewBox="0 0 100 70" data-gate-shape={kind} className="gate-shape" style={{ overflow: 'visible' }}>
      <path d={bodyPath(kind)} className="gate-shape__body" data-live={live} />
      {cx !== null && <circle cx={cx} cy="35" r="6" className="gate-shape__bubble" data-bubble data-live={live} />}
    </svg>
  );
}
```

- [ ] **Step 4: Run the gateShapes test — passes**

Run: `pnpm --filter @polymath/web exec vitest run src/components/gateShapes.test.tsx`
Expected: PASS.

- [ ] **Step 5: Fill `circuit.css` with node/palette/canvas styling**

Replace the Task-3 stub in `apps/web/src/styles/circuit.css`:
```css
/* Circuit canvas — calm dotted surface, ANSI gate shapes, green signal. */
.gate-shape { width: 100%; height: 100%; }
.gate-shape__body { fill: var(--color-surface); stroke: var(--color-ink); stroke-width: 2.5; }
.gate-shape__body[data-live='true'] { fill: var(--color-signal-tint); stroke: var(--color-pass); }
.gate-shape__bubble { fill: var(--color-surface); stroke: var(--color-ink); stroke-width: 2.5; }
.gate-shape__bubble[data-live='true'] { fill: var(--color-signal-tint); stroke: var(--color-pass); }

.circuit-builder { display: flex; flex-direction: column; gap: 0.85rem; }
.circuit-palette { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.circuit-palette button { display: flex; align-items: center; gap: 0.45rem; background: var(--color-surface);
  border: 1px solid var(--color-border); border-radius: var(--radius-pill); padding: 0.35rem 0.8rem 0.35rem 0.45rem;
  font-family: var(--font-mono); font-size: 0.74rem; font-weight: 600; color: var(--color-ink); cursor: pointer;
  box-shadow: var(--shadow-sm); transition: transform var(--dur-hover) var(--ease-spring); }
.circuit-palette button:hover { transform: translateY(-2px); box-shadow: var(--shadow-card); }
.circuit-palette button .gate-shape { width: 26px; height: 18px; }
.circuit-canvas { border-radius: var(--radius-1); overflow: hidden;
  background: radial-gradient(circle at 1px 1px, rgba(32,35,68,0.10) 1px, transparent 0) 0 0 / 22px 22px, var(--color-surface-muted); }
.circuit-controls { display: flex; gap: 0.6rem; }
.circuit-verdict { font-family: var(--font-body); }
/* react-flow node wrappers */
.rf-node { font-family: var(--font-mono); font-weight: 600; border-radius: var(--radius-1);
  background: var(--color-surface); box-shadow: var(--shadow-sm); padding: 6px 10px; }
.rf-node[data-active='true'] { background: var(--color-signal-tint); box-shadow: 0 0 0 2px var(--color-pass), 0 0 12px var(--color-signal-glow); }
/* react-flow edges carry the signal color via CSS var override */
.react-flow__edge-path { stroke: var(--color-low); stroke-width: 3; }
.react-flow__edge.animated .react-flow__edge-path, .react-flow__edge[data-live='true'] .react-flow__edge-path {
  stroke: var(--color-signal); filter: drop-shadow(0 0 4px var(--color-signal-glow)); }
```

- [ ] **Step 6: Render gate shapes in `circuitNodes.tsx` (replace inline boxes)**

In `circuitNodes.tsx`, replace the `activeStyle` inline-object approach: keep the `useIsActive` hook and the `data-node`/`data-active` attributes (tests/pulse rely on them), but render the gate node body with `<GateShape>` and move styling to the `.rf-node` class. For `GateNode`:
```tsx
import { GateShape, type GateShapeKind } from './gateShapes.js';
// ...
export function GateNode({ id, data }: NodeProps): ReactElement {
  const d = data as { gate?: string };
  const active = useIsActive(id);
  const isNot = d.gate === 'NOT';
  return (
    <div className="rf-node rf-node--gate" data-node="gate" data-gate={d.gate} data-active={active}
         style={{ width: 64, height: 46 }}>
      <Handle type="target" position={Position.Left} id="a" style={{ top: isNot ? '50%' : '30%' }} />
      {!isNot && <Handle type="target" position={Position.Left} id="b" style={{ top: '70%' }} />}
      <GateShape kind={(d.gate as GateShapeKind) ?? 'AND'} live={active} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```
For `InputNode`/`OutputNode`: keep the `<div data-node=... data-active=...>` with the `rf-node` class and the label text (`name` / `OUT`); drop the inline `activeStyle` (the `.rf-node[data-active='true']` CSS handles the lit state). Keep all `Handle`s and `data-*`.

- [ ] **Step 7: Add gate-shape icons to the palette buttons (names unchanged)**

In `CircuitBuilder.tsx`, the palette maps over `allowedGates`. Put a `<GateShape>` before the existing text — keep the button's accessible name `Add ${g} gate` and `data-gate`:
```tsx
<button key={g} type="button" onClick={() => addGate(g)} data-gate={g}>
  <GateShape kind={g as GateShapeKind} />
  Add {g} gate
</button>
```
Import `GateShape, GateShapeKind` at the top. (The text node keeps the accessible name; the SVG has no `aria-label`, so axe/name lookups are unaffected.)

- [ ] **Step 8: Run circuit tests + full web suite**

Run:
```bash
pnpm --filter @polymath/web exec vitest run src/components/CircuitBuilder.test.tsx src/components/gateShapes.test.tsx src/canvas
pnpm --filter @polymath/web test
```
Expected: PASS (button names, `data-gate`, `Test it`/`Submit`/`Next gate →`, pulse `data-active` all intact).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/gateShapes.tsx apps/web/src/components/gateShapes.test.tsx apps/web/src/components/circuitNodes.tsx apps/web/src/components/CircuitBuilder.tsx apps/web/src/styles/circuit.css
git commit -m "feat(web): ANSI gate shapes + signal-green circuit canvas"
```

---

## Task 6: Pseudocode editor — friendly notebook theme

**Files:**
- Modify: `apps/web/src/components/PseudocodeChallenge.tsx`
- Test: `apps/web/src/components/PseudocodeChallenge.test.tsx` (must stay green)

- [ ] **Step 1: Run the existing pseudocode tests (baseline)**

Run: `pnpm --filter @polymath/web exec vitest run src/components/PseudocodeChallenge.test.tsx`
Expected: PASS.

- [ ] **Step 2: Replace the inline `EditorView.theme` with the brand theme**

In `PseudocodeChallenge.tsx`, swap the existing `EditorView.theme({...})` extension for one driven by the tokens (CodeMirror needs literal values; read them from CSS vars at mount via `getComputedStyle`, with hex fallbacks):
```tsx
const css = getComputedStyle(document.documentElement);
const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
// ... in extensions:
EditorView.theme({
  '&': { borderRadius: 'var(--radius-1, 10px)', border: `1px solid ${v('--color-border', 'rgba(32,35,68,0.10)')}`,
         background: v('--color-surface', '#fff'), fontFamily: v('--font-mono', 'JetBrains Mono, monospace') },
  '.cm-content': { minHeight: '5em', padding: '12px', fontSize: '16px', lineHeight: '1.6',
                   caretColor: v('--color-accent', '#4a4bb6'), color: v('--color-text', '#202344') },
  '.cm-placeholder': { color: v('--color-text-muted', '#6b6f8a'), fontStyle: 'italic' },
  '&.cm-focused': { outline: `2px solid ${v('--color-focus', '#4a4bb6')}`, outlineOffset: '2px' },
  '.cm-line': { padding: '0 4px' },
}),
```
Keep `booleanPseudocodeExtension`, `placeholder(...)`, `keymap.of(defaultKeymap)`, the `updateListener`, and `contentAttributes` (`aria-labelledby`) exactly as they are.

- [ ] **Step 3: Restyle the heading + target chip + feedback with classNames**

Replace the inline-styled heading/`<code>`/feedback with token-driven classes. The heading `<h2 id={EDITOR_LABEL_ID}>` keeps its id; wrap the target in `<code className="pseudo-target">`. Feedback paragraphs keep `role="alert"` / `role="status"` and the `status-fail`/`status-pass` classNames (already styled globally). Add to `global.css`:
```css
.pseudo-target { font-family: var(--font-mono); background: var(--color-lavender); color: var(--color-accent);
  padding: 0.1rem 0.5rem; border-radius: var(--radius-1); font-weight: 600; }
.pseudo-ok { background: linear-gradient(90deg, var(--color-signal-tint), transparent 60%);
  border-left: 3px solid var(--color-pass); padding-left: 0.5rem; }
```

- [ ] **Step 4: Run the pseudocode tests + full web suite**

Run: `pnpm --filter @polymath/web test`
Expected: PASS (`data-testid="source-input"`, region/label, alert/status, submit name intact).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PseudocodeChallenge.tsx apps/web/src/styles/global.css
git commit -m "feat(web): friendly notebook theme for the pseudocode editor"
```

---

## Task 7: Lesson shell + mastery celebration

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/MasteryCelebration.tsx`
- Modify: `apps/web/src/components/LessonIntro.tsx` (if it carries the title block)
- Modify: `apps/web/src/styles/global.css`
- Test: existing `App.*.test.tsx`, `MasteryCelebration.test.tsx` (must stay green)

- [ ] **Step 1: Run the App + celebration tests (baseline)**

Run: `pnpm --filter @polymath/web exec vitest run src/App.refusal.test.ts src/App.recall.test.tsx src/App.transition.test.tsx src/components/MasteryCelebration.test.tsx`
Expected: PASS.

- [ ] **Step 2: Add the shell header markup in `App.tsx` (additive, handlers unchanged)**

At the top of the returned `<main>`, before the consent modal / session, add a header element (purely presentational — no new state, no wire events):
```tsx
<header className="app-shell-top">
  <div className="app-logo"><span className="app-logo__mark">◑</span> Polymath</div>
  <div className="app-shell-progress" data-phase={phase}>
    <span className="phase-chip">{phase}</span>
  </div>
</header>
```
> Keep the existing `<p aria-live="polite" data-conn={conn} data-phase={phase}>` connection line — tests may read `data-phase`/`data-conn`. The new header's `phase-chip` is decorative; do not remove the existing aria-live status node.

- [ ] **Step 3: Style the shell + ask-bar voice layout in `global.css`**

Append:
```css
.app-shell-top { display: flex; align-items: center; gap: 1rem; padding: 0.9rem 0; margin-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-border); }
.app-logo { display: flex; align-items: center; gap: 0.55rem; font-family: var(--font-display); font-weight: 700; color: var(--color-ink); }
.app-logo__mark { width: 1.6rem; height: 1.6rem; border-radius: 8px; background: var(--gradient-primary);
  display: flex; align-items: center; justify-content: center; color: #fff; box-shadow: var(--shadow-sm); }
.app-shell-progress { margin-left: auto; }
.phase-chip { font-family: var(--font-mono); font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase;
  font-weight: 600; padding: 0.2rem 0.6rem; border-radius: var(--radius-pill);
  background: var(--color-signal-tint); color: var(--color-pass); }
```

- [ ] **Step 4: Spectrum-gradient the mastery celebration**

In `MasteryCelebration.tsx`, keep all text/structure and any `data-*`/role the test asserts; wrap the content so the `.mastery-celebration` card gets the gradient. Add to `global.css`:
```css
.mastery-celebration { position: relative; overflow: hidden; border: none; color: #fff; text-align: center;
  background: var(--color-ink); padding: 2.2rem 1.5rem; }
.mastery-celebration::before { content: ''; position: absolute; inset: 0; background: var(--gradient-spectrum); opacity: 0.92; }
.mastery-celebration > * { position: relative; z-index: 1; }
.mastery-celebration h1, .mastery-celebration h2, .mastery-celebration h3 { color: #fff; }
@media (prefers-reduced-motion: reduce) { .mastery-celebration::before { opacity: 0.92; } } /* static, no anim either way */
```
(The celebration uses no animation, satisfying the motion budget — the gradient is static.)

- [ ] **Step 5: Run the App + celebration + a11y suites**

Run: `pnpm --filter @polymath/web test`
Expected: PASS (all `App.*`, celebration text/role, axe contrast — note the gradient card uses white text on a saturated bg; if axe flags the celebration heading contrast, add a `text-shadow` and confirm the largest text clears AA, or scope the axe exception as the existing pattern allows).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/MasteryCelebration.tsx apps/web/src/styles/global.css
git commit -m "feat(web): lesson shell header + spectrum-gradient mastery moment"
```

---

## Task 8: Full verification pass + screenshot evidence

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the web package**

Run: `pnpm --filter @polymath/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the whole web suite in isolation**

Run: `pnpm --filter @polymath/web test`
Expected: PASS (all suites, including a11y.axe and tokenContrast).

- [ ] **Step 3: Build the web app (catch DCE / asset issues)**

Run: `pnpm --filter @polymath/web build`
Expected: build succeeds; `dist/` contains the hashed font files (grep: `ls apps/web/dist/assets | grep -i woff2 || ls apps/web/dist/fonts`).

- [ ] **Step 4: Drive the running app and capture before/after screenshots**

Use the `run` or `verify` skill (or the dev server + chrome-devtools MCP) to load `/`, accept consent, and screenshot the intro, a truth-table item, the circuit, the pseudocode editor, and (via the `?lesson=` seam if needed) the celebration. Save shots to `docs/design-prototypes/after/`.

- [ ] **Step 5: Final commit (screenshots only)**

```bash
git add docs/design-prototypes/after
git commit -m "docs(design): after-redesign screenshots"
```

---

## Self-Review notes (author)

- **Spec coverage:** light hero (Task 2–3), row-pill truth table (Task 4), ANSI gates + pulse canvas (Task 5), friendly editor (Task 6), shell + reserved spectrum gradient (Task 7), self-hosted fonts (Task 1). All BRAND.md tokens land in Task 2. ✓
- **Test-coupling traps** are called out per task (table semantics, button names, CM seams, token names/AA). ✓
- **Type consistency:** `GateShapeKind` defined in Task 5 Step 3, used in Steps 6–7; `GateShape` props (`kind`, `live`) consistent across node + palette. ✓
- **No contract/booleans/agent edits** anywhere. ✓
- **Out of scope (explicit):** multi-rep linked highlighting, onboarding, phase-transition choreography — a later pass per the spec.
