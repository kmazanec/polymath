/**
 * InteractiveHero — "Poke it once, all three light up"
 *
 * The hero centerpiece is A LIVE PRODUCT PREVIEW, not a static illustration.
 * Two pill toggles (A / B) control one shared boolean state. Three synchronized
 * panels — truth table, AND gate circuit, pseudocode — react INSTANTLY with NO
 * submit step. The same signal-green (#14c98a / --color-signal, --color-pass)
 * is the single accent across all three, so "one idea in three skins" is felt
 * before the learner reads a word.
 *
 * Accessibility contract:
 *  - Toggle buttons are real <button> with aria-pressed so screen readers announce
 *    "A, pressed / not pressed".
 *  - The three panels are wrapped in aria-hidden="true" — they are decorative
 *    previews. A single, always-visible aria-live="polite" paragraph provides a
 *    concise text summary of the current state so AT users get the concept without
 *    being blasted with 12 cells on every toggle.
 *  - prefers-reduced-motion: state still changes instantly (the panels update via
 *    className) but the CSS @keyframes pulse/glow are suppressed in the stylesheet.
 *    Users still see the correct green/muted state — just no animation.
 *  - Tap targets: the A/B toggles are min 44px via padding + min-height in CSS.
 *  - Focus: global :focus-visible ring covers the buttons; no keyboard trap.
 *
 * Self-contained: no WebSocket, no session, no lesson-component imports.
 * Pure useState — safe for the marketing page.
 */

import { useState, useId } from 'react';
import type { ReactElement } from 'react';
import './interactiveHero.css';

// A AND B truth table rows, MSB-first (matches @polymath/booleans convention).
const ROWS = [
  { a: 0 as 0 | 1, b: 0 as 0 | 1, out: 0 as 0 | 1 },
  { a: 0 as 0 | 1, b: 1 as 0 | 1, out: 0 as 0 | 1 },
  { a: 1 as 0 | 1, b: 0 as 0 | 1, out: 0 as 0 | 1 },
  { a: 1 as 0 | 1, b: 1 as 0 | 1, out: 1 as 0 | 1 },
] as const;

export function InteractiveHero(): ReactElement {
  // Start A=1, B=1 so the output is HIGH on page load — signal-green is the first
  // thing the eye sees, not an all-gray widget. The aria-live summary derives from
  // state so AT users get the correct initial reading automatically.
  const [a, setA] = useState<0 | 1>(1);
  const [b, setB] = useState<0 | 1>(1);
  const output = (a === 1 && b === 1 ? 1 : 0) as 0 | 1;
  const liveId = useId();

  return (
    <div className="ihero">
      {/* ── Input toggles ── */}
      <div
        className="ihero__controls"
        role="group"
        aria-label="AND gate inputs"
        aria-describedby={liveId}
      >
        <InputToggle label="A" value={a} onToggle={() => setA(v => (v === 0 ? 1 : 0))} />
        <InputToggle label="B" value={b} onToggle={() => setB(v => (v === 0 ? 1 : 0))} />
        {/* Hint is visible to sighted users AND AT — no aria-hidden */}
        <p className="ihero__hint">Try it — toggle the inputs</p>
      </div>

      {/* Screen-reader live summary — always present, never reads the 12 cells */}
      <p
        id={liveId}
        className="visually-hidden"
        aria-live="polite"
        aria-atomic="true"
      >
        {`A is ${a}, B is ${b}. A AND B equals ${output}.`}
      </p>

      {/* ── Three synchronized panels (decorative — AT reads the live summary above) ── */}
      <div className="ihero__panels" aria-hidden="true">
        <TruthTablePanel a={a} b={b} />
        <CircuitPanel a={a} b={b} output={output} />
        <PseudocodePanel output={output} />
      </div>
    </div>
  );
}

// ── Input toggle button ──────────────────────────────────────────────────────

function InputToggle({
  label,
  value,
  onToggle,
}: {
  label: string;
  value: 0 | 1;
  onToggle: () => void;
}): ReactElement {
  const isOn = value === 1;
  return (
    <button
      type="button"
      className={`ihero__toggle ${isOn ? 'ihero__toggle--on' : 'ihero__toggle--off'}`}
      aria-pressed={isOn}
      onClick={onToggle}
    >
      <span className="ihero__toggle-label">{label}</span>
      <span className={`ihero__toggle-bit ${isOn ? 'ihero__toggle-bit--on' : ''}`}>
        {value}
      </span>
    </button>
  );
}

// ── Truth table panel ────────────────────────────────────────────────────────

function TruthTablePanel({ a, b }: { a: 0 | 1; b: 0 | 1 }): ReactElement {
  return (
    <div className="ihero__card ihero__card--table">
      <span className="ihero__tag">truth table</span>
      <table className="ihero__tt">
        <thead>
          <tr>
            <th scope="col">A</th>
            <th scope="col">B</th>
            <th scope="col" className="ihero__tt-th--out">A·B</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row, i) => {
            const active = row.a === a && row.b === b;
            return (
              <tr
                key={i}
                className={
                  active
                    ? 'ihero__tt-row--active'
                    : undefined
                }
              >
                <td>
                  <Bit value={row.a} active={active} />
                </td>
                <td>
                  <Bit value={row.b} active={active} />
                </td>
                <td>
                  <Bit value={row.out} active={active} isOut />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Bit({
  value,
  active,
  isOut = false,
}: {
  value: 0 | 1;
  active: boolean;
  isOut?: boolean;
}): ReactElement {
  const high = value === 1;
  let cls = 'ihero__bit';
  if (isOut && high) cls += ' ihero__bit--signal';
  else if (high && active) cls += ' ihero__bit--input-hi';
  else cls += ' ihero__bit--off';
  return <span className={cls}>{value}</span>;
}

// ── Circuit panel ─────────────────────────────────────────────────────────────

function CircuitPanel({
  a,
  b,
  output,
}: {
  a: 0 | 1;
  b: 0 | 1;
  output: 0 | 1;
}): ReactElement {
  const aHi = a === 1;
  const bHi = b === 1;
  const outHi = output === 1;

  return (
    <div className="ihero__card ihero__card--gate">
      <span className="ihero__tag">circuit</span>
      <div className="ihero__svg-wrap">
      <svg
        className="ihero__svg"
        viewBox="0 0 200 120"
        role="img"
        aria-label={`AND gate: A=${a}, B=${b}, output=${output}`}
      >
        {/* ── Wire: A input (top) ── */}
        <line
          x1="8" y1="42" x2="56" y2="42"
          className={`ihero__wire ${aHi ? 'ihero__wire--hi' : 'ihero__wire--lo'}`}
        />
        {/* ── Wire: B input (bottom) ── */}
        <line
          x1="8" y1="78" x2="56" y2="78"
          className={`ihero__wire ${bHi ? 'ihero__wire--hi' : 'ihero__wire--lo'}`}
        />

        {/* ── Input labels ── */}
        <text x="4" y="38" className="ihero__wirelabel">A</text>
        <text x="4" y="74" className="ihero__wirelabel">B</text>

        {/* ── AND gate body: ANSI D-shape (flat back, semicircular front) ── */}
        <path
          d="M56 26 H100 a34 34 0 0 1 0 68 H56 Z"
          className={`ihero__gatebody ${outHi ? 'ihero__gatebody--hi' : ''}`}
        />
        {/* Gate & label */}
        <text x="70" y="65" className="ihero__gatelabel">&amp;</text>

        {/* ── Output wire ── */}
        <line
          x1="134" y1="60" x2="188" y2="60"
          className={`ihero__wire ${outHi ? 'ihero__wire--hi' : 'ihero__wire--lo'}`}
        />
        {/* ── Output node (filled circle at the wire end) ── */}
        <circle
          cx="188" cy="60" r="5.5"
          className={`ihero__node ${outHi ? 'ihero__node--hi' : 'ihero__node--lo'}`}
        />
      </svg>
      </div>
    </div>
  );
}

// ── Pseudocode panel ──────────────────────────────────────────────────────────

function PseudocodePanel({ output }: { output: 0 | 1 }): ReactElement {
  const high = output === 1;
  return (
    <div className="ihero__card ihero__card--code">
      <span className="ihero__tag">pseudocode</span>
      <pre className="ihero__code">
        <code>
          <span className="ihero__tok-kw">out</span>
          {' = a '}
          <span className="ihero__tok-op">AND</span>
          {' b'}
          {'  '}
          <span className={`ihero__tok-comment ${high ? 'ihero__tok-comment--hi' : ''}`}>
            {`// ${output}`}
          </span>
        </code>
      </pre>
      <p className="ihero__code-sub">
        {high
          ? <><span className="ihero__code-check" aria-hidden="true">✓</span>{' '}both inputs HIGH — output HIGH</>
          : <><span className="ihero__code-cross" aria-hidden="true">·</span>{' '}at least one input LOW</>
        }
      </p>
    </div>
  );
}
