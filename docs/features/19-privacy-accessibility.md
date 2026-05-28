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

## Implementation notes (filled in by the building agent)

> Empty.
