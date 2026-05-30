# After-redesign screenshots

Captured from the running app (`pnpm --filter @polymath/web dev`, light color-scheme
emulated — the designed-for hero theme) on branch `ui-redesign`. These verify the
redesign renders in the real app, not just the standalone prototype.

- **01-shell-light.png** — the lesson shell: Polymath logo + gradient mark, the
  signal-green phase chip ("INTRODUCING"), Poppins heading, atmospheric lavender
  background, rounded card, pill ask-bar + indigo Ask button. (Consent modal is the
  app's normal first-run gate.)
- **02-components-light.png** — all four core surfaces in one view: row-pill truth
  table, ANSI-gate circuit palette + canvas, friendly pseudocode editor with the
  lavender target chip, and the spectrum-gradient mastery moment.
- **03-truthtable-toggled.png** — the row-pill truth table with the (1,1) output
  toggled to 1: the green pressed state with the glowing signal-green ring, input
  bits as green-ringed chips (1) / muted chips (0).
- **04-circuit-with-gate.png** — the circuit canvas after adding an AND gate: it
  renders as a proper **ANSI D-shape** (flat back, rounded front) with I/O ports on
  the calm dotted surface; the palette shows all five gate icons.

## Note on the mastery celebration

The celebration substrate is a **theme-fixed dark navy (`#202344`)** with the spectrum
gradient laid over it via `mix-blend-mode: multiply`. That multiply is what keeps white
text at ~15:1 contrast (WCAG AA) in BOTH light and dark OS themes — the dark-mode bug
the review caught (where a theme-flipping `--color-ink` collapsed contrast to ~1.6:1)
is fixed and guarded by `tokenContrast.test.ts`. The visible tradeoff is that the
gradient reads more muted/darker than the standalone prototype's full-vibrancy version;
that is the deliberate accessibility-over-vibrancy choice. If we later want more pop, the
move is a lighter scrim layer tuned to keep AA, not re-binding the substrate to a theme
token.
