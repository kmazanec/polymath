# Feature: Privacy + accessibility audit + writeup

**ID:** F-19 · **Iteration:** I5 — MVP+ polish · **Status:** Not started

## What this delivers (before → after)

**Before:** The architecture commits to accessibility and privacy properties ([ADR-012](../adrs/ADR-012-stretch-features-for-nerdy.md)) but they are not verified, audited, or documented end-to-end.

**After:** A verified, audited, and documented privacy + accessibility posture. Specifically: keyboard navigation across every interactive surface verified; screen-reader announcements verified for the pulse, mastery transitions, transfer-probe entry/exit, refusal copy; color-blind-safe palette confirmed via DevTools deuteranopia simulation; reduced-motion behavior verified; mic permission deferred to first-use verified; no webcam access verifiable; PostHog session replay off-by-default verified; session-data deletion default on-close verified; WCAG 2.1 AA contrast checked; `docs/privacy-and-accessibility.md` shipped (~200 words per [ADR-012](../adrs/ADR-012-stretch-features-for-nerdy.md)). Any audit findings fixed in this iteration's code.

After F-19, the language in the writeup is "designed to align with FERPA principles and WCAG 2.1 AA" — defensible.

## How it fits the roadmap

I5, **off the critical path**. Concurrent with F-18 and F-20.

## Dependencies (must exist before this starts)

- **F-15** — all MVP UI surfaces exist (across L1 and L2, including transfer probes, voice, mastery celebration).

## Unblocks (what waits on this)

- **F-21** — counter-metrics dashboard claims accessibility correctness.

## Contracts touched

- **`docs/privacy-and-accessibility.md`** — introduced. Single source of truth for the writeup.
- **`apps/web`** — any audit-finding fixes live here. Not a contract change, but the audit may reshape components.
- **No schema changes.**

## Sub-tasks

1. **T-19a — Run axe-core across every page** `[parallel]`
   - Automated audit; capture findings.
2. **T-19b — Manual keyboard-only walkthrough** `[parallel]`
   - Complete an L1+L2 session using only the keyboard; document any gaps.
3. **T-19c — Screen-reader walkthrough (VoiceOver + NVDA)** `[parallel]`
   - Verify pulse announcements, mastery transitions, transfer-probe refusals.
4. **T-19d — Color-blind simulation + contrast check** `[parallel]`
   - DevTools deuteranopia/protanopia/tritanopia simulation; WCAG contrast checker on text + UI components.
5. **T-19e — Fix findings** `[serial after T-19a..T-19d]`
   - Each finding becomes a small code change in `apps/web`.
6. **T-19f — `docs/privacy-and-accessibility.md` writeup** `[parallel]`
   - 200 words covering: no webcam, no facial affect, no minor PII, opaque session IDs, PostHog opt-in, session-data deletion, WCAG 2.1 AA, keyboard-first, reduced motion, screen-reader, color-blind-safe.
7. **T-19g — In-app "About this session's data" affordance** `[parallel]`
   - A small button somewhere visible (footer?) that opens a modal with the writeup.

## Acceptance criteria (product behavior)

1. **An axe-core run** on every route returns zero serious or critical findings.
2. **Completing an L1+L2 session using only the keyboard** is possible without losing focus or hitting an unreachable affordance.
3. **VoiceOver narrates** pulse propagation, mastery transitions, transfer-probe entry/exit, and the refusal copy in semantically correct order.
4. **Color-blind simulation** (deuteranopia) does not break the correct/incorrect distinction — verified by passing/failing a circuit in simulator and confirming the verdict is still readable.
5. **`prefers-reduced-motion: reduce`** replaces the pulse with step-through navigation; no transitions fire outside the explain-back countdown.
6. **Microphone permission is not requested** at session start — verified in a fresh incognito session.
7. **No webcam access is requested** at any point — verified by checking `navigator.mediaDevices.getUserMedia` calls in source and at runtime.
8. **PostHog session replay is OFF by default**; an opt-in modal must be acknowledged before replay starts.
9. **Session data deletion** fires by default on session close, with a 24h grace period for the eval/replay tool (configurable).
10. **`docs/privacy-and-accessibility.md` exists** with ≤200 words and aligned to [ADR-012](../adrs/ADR-012-stretch-features-for-nerdy.md)'s posture.
11. **The "About this session's data" affordance** is visible from any route and opens a modal with the writeup.

## Testing requirements

- axe-core automated tests in CI for every route.
- Manual audit checklist (T-19b, T-19c, T-19d) — completed once; findings logged.
- E2E test: PostHog session replay disabled at session start, enabled only after explicit opt-in click.
- Source-level test: search for any `getUserMedia` call with `video: true` and fail if found.

## Manual setup required

- VoiceOver and NVDA testing — VoiceOver on Mac (Keith's setup); NVDA via Windows VM if available, otherwise document the limitation.
- Color-blind simulation in Chrome DevTools.

## Convergence and expected rework

⚠ **Audit findings may reshape components shipped in I1.** Mitigation: most findings will be small (missing labels, focus indicators). Larger findings (e.g., react-flow accessibility gaps) need to be triaged in real time.

⚠ **F-19 concurrent with F-18 and F-20**: zero file overlap by design (F-19 fixes a11y issues across components but those components stabilised in I1; F-18 adds a new route; F-20 adds wiring code). Conflicts are individual-line-level and trivial to resolve.

## Build plan (approved)

**Iteration:** I5 (`i5-polish-observability-metrics`) · **Model tier:** Opus · **Runs:** concurrent with F-18, F-20 after the Step-0 barrier. **Owns the most load-bearing shared seam in I5.**

**Tier rationale:** Touches the missing global stylesheet + design tokens that **F-18 and F-21 depend on**, writes the canonical privacy/opt-in copy **F-20 consumes**, and adds an agent-side deletion path (schema-adjacent, must fail closed). Spans web + agent + docs and reshapes I1 components from audit findings → Opus.

**Build summary — the spec is mis-scoped as "just an audit + writeup."** VERIFIED elephant: **`apps/web/src` has NO global stylesheet** — every className (`.visually-hidden` at `CircuitBuilder.tsx:227`, `hint-card--level-N`, the slot classes) is UNDEFINED; the only source CSS is CircuitBuilder's react-flow import, and `dist/assets/*.css` is a STALE react-flow build artifact, not a source baseline. So F-19 FIRST establishes the baseline stylesheet + WCAG-AA color tokens + a real `.visually-hidden` + `@media (prefers-reduced-motion)` (wiring `AnimateOrNot`'s existing `data-animate`/`data-phase` hooks, which today have no CSS behind them) + an `@media print` partial — because F-18/F-21 build on those tokens. Second, a route-independent focus-trapped "About this session's data" modal in `App`'s `<main>` (survives every route). Third, `docs/privacy-and-accessibility.md` (≤200 words) sourced from a `copy/privacy.ts` module **F-20's consent modal imports** (ordering: F-19 writes copy first). Fourth, the agent-side gap: `sessions.endedAt` exists but is never written for polymath; the `session_end` ClientEvent exists (`wire.ts:132`) but no handler deletes data — AC#9 needs a deletion path keyed off **server-side WS-close detection** (App.tsx doesn't emit `session_end`), failing CLOSED (default delete) after a configurable 24h grace. Fifth, the actual audit (axe-core per route, keyboard + SR + deuteranopia walkthroughs, fix findings in-place). **Already-true in code (just verify):** `getUserMedia` is called once (`voice/client.ts:177`, `{audio:true}`, on click) — mic deferred, no webcam.

**Checklist:**

- [ ] `apps/web/src/styles/tokens.css`: WCAG-2.1-AA color custom properties (correct/incorrect/neutral/text/bg), **deuteranopia-safe (blue/orange, not red/green)**, ≥4.5:1 body / ≥3:1 UI contrast, ratios documented in comments. **This is the F-18/F-21 dependency — the SINGLE `:root` token block in apps/web** (barrier B4 ownership rule).
- [ ] `apps/web/src/styles/global.css`: a REAL `.visually-hidden` (clip-rect), baseline layout for the existing BEM classNames (hint-slot, recall-slot, agent-answer*, circuit-*, transfer-probe*, explain-back*, mastery-celebration, lesson-intro), `:focus-visible` indicators, `@media (prefers-reduced-motion: reduce){ [data-animate]{…step-through, no transition…} }` wiring `AnimateOrNot`, and **the only global `@media print` reset** (F-18/F-21 keep their print styles view-scoped).
- [ ] Import the stylesheet once from `apps/web/src/main.tsx` (`import './styles/global.css'`) so it loads on every route incl. F-18's; `pnpm --filter @polymath/web build` confirms it bundles.
- [ ] `apps/web/src/copy/privacy.ts`: canonical privacy posture strings + the PostHog opt-in modal copy (off-by-default, informed-consent), aligned to ADR-012's six bullets. **F-20's consent modal imports this** (ordering: F-19 first; F-20 ships a one-line placeholder swap so it does not serially block).
- [ ] `docs/privacy-and-accessibility.md` (≤200 words) from `copy/privacy.ts`: no webcam, no facial affect, no minor PII, opaque session IDs, PostHog opt-in/off-by-default, session-data deletion + 24h grace, WCAG 2.1 AA, keyboard-first, reduced motion, screen-reader, color-blind-safe. Assert word count in a test (AC#10).
- [ ] TEST-FIRST: `apps/web/src/components/AboutSessionData.test.tsx` — modal opens from a visible trigger, focus-trapped (Tab cycles, Esc closes, focus returns), `role=dialog`+`aria-modal`+`aria-labelledby`, renders `copy/privacy.ts` text. Then build `AboutSessionData.tsx` and mount it in `App.tsx`'s `<main>` (route-independent footer affordance — **D-loc**: lift to a shared layout when F-18's routes land).
- [ ] TEST-FIRST: `apps/web/src/a11y.axe.test.tsx` using **jest-axe** (add to devDeps — **D9**) over jsdom-renderable surfaces (LessonIntro, HintCard, AgentAnswer, TruthTablePractice, AboutSessionData, mastery celebration) asserting 0 serious/critical (mock AgentSocket per `App.recall.test.tsx:22-34`). Fix findings (labels, contrast via token classes, heading order) in the offending I1 components.
- [ ] Add `apps/web/e2e/axe.spec.ts` running **`@axe-core/playwright`** against `/` in a REAL browser to cover react-flow (CircuitBuilder) + CodeMirror (PseudocodeChallenge), **not drivable in jsdom** (jsdom-only would false-pass the two richest widgets); gate on 0 serious/critical.
- [ ] Source-level guard test: scan `apps/web/src` for `getUserMedia({video…})`/`video:true`, fail if present (AC#7); assert the only call is `voice/client.ts:177` `{audio:true}` on click.
- [ ] AGENT TEST-FIRST: handler test for the existing `session_end` ClientEvent in `server.ts` — on session end, stamp `sessions.endedAt` + schedule deletion of session-scoped `events`/`learner_state` after `POLYMATH_SESSION_DATA_GRACE_HOURS` (default 24); **default is DELETE (fail-closed)**. Scope every read/delete to `events.app IS NULL` (D3 discriminator). Owner-self-initiated ⇒ exempt from `checkOperatorAuth` (like the followup token).
- [ ] AGENT: implement deletion — **server-side WS-close detection** as session end (**D3-decision**; `beforeunload`/`sendBeacon` is unreliable and App.tsx doesn't emit `session_end`) → set `endedAt` + a `deleteAfter` stamp; a lazy/bounded sweep (on next boot or a small interval) hard-deletes expired polymath (`app IS NULL`) sessions' events + learner_state (**D4 = hard-delete, configurable grace**). Non-fatal (degrade, don't crash boot).
- [ ] Run the manual audit checklists (T-19b keyboard L1+L2; T-19c VoiceOver SR for pulse/mastery/transfer-enter-exit/refusal order; T-19d DevTools deuteranopia + contrast) against the running stack; log findings inline here; fix each as a small className/aria change. NVDA: document as a limitation if no Windows VM.
- [ ] Full verification (below).

**Decisions (recommended defaults — see manifest):** D3 server-side WS-close = session end · D4 hard-delete after configurable 24h grace (`POLYMATH_SESSION_DATA_GRACE_HOURS`), F-21 metrics computed within-window / from non-deleted experiment subjects · D9 add jest-axe + @axe-core/playwright dev-only · D12 PostHog session replay off-by-default, on only in the consented branch (copy lives here).

**Verification:** `pnpm typecheck` · `pnpm --filter @polymath/web test` (axe + AboutSessionData + existing) · `pnpm --filter @polymath/web build` · `pnpm --filter @polymath/web e2e` (Playwright axe vs `/`, 0 serious/critical incl. react-flow + CodeMirror) · `pnpm --filter @polymath/agent test` (session_end ⇒ endedAt + scheduled deletion, scoped `app IS NULL`) · grep guard: no `getUserMedia({video})` in `apps/web/src` · `wc -w docs/privacy-and-accessibility.md` (≤200).

## Implementation notes (filled in by the building agent)

> Empty.
