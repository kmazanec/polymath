# Privacy and accessibility posture

Polymath is designed to align with FERPA principles and WCAG 2.1 AA.

## Privacy

- **No webcam access** at any point, and no facial-affect or eye tracking.
- **No minor PII** is retained by default; the session ID is an opaque random token, and logs are anonymised before persistence.
- The **microphone** is requested only when the learner presses "Ask the tutor", never at session start.
- **PostHog session replay and product analytics are off by default** and begin only after an explicit, informed opt-in.
- **Session data is deleted by default when the session ends**, after a configurable 24-hour grace period for the eval/replay tool.

## Accessibility

- **WCAG 2.1 AA contrast**: ≥4.5:1 on body text, ≥3:1 on UI components.
- A **colour-blind-safe palette**: correct/incorrect signals never rely on hue alone.
- **Keyboard-first**: every interaction is operable by keyboard, with a visible focus indicator.
- **Reduced motion** is honoured: the pulse falls back to step-through navigation.
- **Screen-reader announcements** for pulse propagation, mastery transitions, and transfer-probe entry/exit.

These are verifiable properties of the running app, audited via axe-core, keyboard, screen-reader, and colour-blind-simulation walkthroughs.
