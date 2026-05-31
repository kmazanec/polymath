import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import './landing.css';

/**
 * The Polymath landing page — the apex marketing surface at `/`.
 *
 * On-brand per docs/BRAND.md: deep indigo-navy ink, cyan accent, Poppins display
 * over Karla body, big rounded cards, soft indigo shadows, springy reveals. The
 * pedagogical thesis is told *visually* by the three-modality hero trio (a truth
 * table, an ANSI gate, and a line of pseudocode showing the SAME idea). The
 * signature spectrum gradient is deliberately NOT used here — it is reserved for
 * the mastery-celebration moment (BRAND.md "the one wow flourish").
 *
 * Pure static brand surface: no session, no WebSocket. The lesson session only
 * starts when the learner clicks Begin on the overview (`/learn`).
 */
export function Landing(): ReactElement {
  return (
    <div className="landing">
      <BrandField />

      <header className="landing__top">
        <div className="landing__brand">
          <span className="landing__brand-mark" aria-hidden="true">◑</span>
          <span className="landing__brand-name">Polymath</span>
        </div>
        <Link to="/learn" className="landing__top-cta">
          Start learning
        </Link>
      </header>

      <main className="landing__main">
        <section className="landing__hero">
          <div className="landing__hero-copy">
            <p className="landing__eyebrow">Mastery-grade Boolean logic</p>
            <h1 className="landing__headline">
              One idea,
              <br />
              <span className="landing__headline-accent">three&nbsp;forms.</span>
            </h1>
            <p className="landing__sub">
              AND, OR and NOT are the whole alphabet of logic. You truly know a
              concept only when you&rsquo;re fluent across all three of its faces — a{' '}
              <strong>truth table</strong>, a <strong>circuit</strong> you can wire and
              pulse, and a line of <strong>code</strong>. Polymath makes you fluent in
              every one.
            </p>
            <div className="landing__cta-row">
              <Link to="/learn" className="landing__cta">
                Begin Lesson 1
                <span className="landing__cta-arrow" aria-hidden="true">→</span>
              </Link>
              <span className="landing__cta-note">No account · ~10&nbsp;min · free</span>
            </div>
          </div>

          <ModalityTrio />
        </section>

        <section className="landing__pillars" aria-label="How mastery is earned">
          <Pillar
            glyph="≡"
            title="See it three ways"
            body="Every concept arrives as a truth table, a gate circuit, and pseudocode at once — bound together so one action lights up the same idea in all three."
          />
          <Pillar
            glyph="◓"
            title="Practice that responds"
            body="Toggle a cell, wire a gate, write a line — the interface marks you right the instant you act. No waiting, no page reloads. It feels alive."
          />
          <Pillar
            glyph="★"
            title="Mastery you can't fake"
            body="The gate is strict on purpose: held-out transfer items and a spoken explain-back mean a “mastered” learner can't have been pattern-matching or pasting answers."
          />
        </section>

        <section className="landing__strip">
          <p className="landing__strip-lead">The curriculum</p>
          <ol className="landing__lessons">
            <li><span className="landing__lesson-n">1</span> Basic operators</li>
            <li><span className="landing__lesson-n">2</span> Composition &amp; XOR</li>
            <li><span className="landing__lesson-n">3</span> NAND universality</li>
            <li><span className="landing__lesson-n">4</span> De&nbsp;Morgan&rsquo;s law</li>
          </ol>
          <Link to="/learn" className="landing__strip-cta">
            Start with Lesson&nbsp;1 →
          </Link>
        </section>
      </main>

      <footer className="landing__footer">
        <span className="landing__brand-mark landing__brand-mark--sm" aria-hidden="true">◑</span>
        <span>Polymath — a multimodal mastery interface for Boolean logic.</span>
      </footer>
    </div>
  );
}

/** The hero's centerpiece: the same function (A AND B) shown in all three
 *  representations side by side, statically, so the "one idea, three forms" thesis
 *  is legible before the learner reads a word. The active row/cell/token share the
 *  one signal-green accent so they read as a single concept in three skins. */
function ModalityTrio(): ReactElement {
  // A AND B — MSB-first rows (BRAND.md / @polymath/booleans convention).
  const rows: Array<{ a: 0 | 1; b: 0 | 1; out: 0 | 1 }> = [
    { a: 0, b: 0, out: 0 },
    { a: 0, b: 1, out: 0 },
    { a: 1, b: 0, out: 0 },
    { a: 1, b: 1, out: 1 },
  ];
  return (
    <div className="trio" aria-hidden="true">
      <div className="trio__card trio__card--table" style={{ animationDelay: '0.05s' }}>
        <span className="trio__tag">truth table</span>
        <table className="trio__tt">
          <thead>
            <tr><th>A</th><th>B</th><th>A·B</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.out ? 'trio__tt-row--hi' : undefined}>
                <td><Bit on={r.a} /></td>
                <td><Bit on={r.b} /></td>
                <td><Bit on={r.out} out /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="trio__card trio__card--gate" style={{ animationDelay: '0.18s' }}>
        <span className="trio__tag">circuit</span>
        <AndGate />
      </div>

      <div className="trio__card trio__card--code" style={{ animationDelay: '0.31s' }}>
        <span className="trio__tag">pseudocode</span>
        <pre className="trio__code">
          <code>
            <span className="tok-kw">out</span> = a{' '}
            <span className="tok-op">AND</span> b
          </code>
        </pre>
        <div className="trio__code-verdict">
          <span className="trio__check" aria-hidden="true">✓</span> true when both are on
        </div>
      </div>
    </div>
  );
}

function Bit({ on, out = false }: { on: 0 | 1; out?: boolean }): ReactElement {
  return (
    <span className={`trio__bit ${on ? 'trio__bit--on' : 'trio__bit--off'} ${out && on ? 'trio__bit--signal' : ''}`}>
      {on}
    </span>
  );
}

/** A canonical ANSI AND gate (D-shape: flat back, semicircular front) with two live
 *  input wires and an output wire glowing the signal green — the brand's gate
 *  language (BRAND.md §"Logic gates"). SVG so it scales crisply in the hero. */
function AndGate(): ReactElement {
  return (
    <svg className="trio__svg" viewBox="0 0 160 96" role="img" aria-label="AND gate">
      {/* input wires */}
      <line x1="6" y1="32" x2="48" y2="32" className="trio__wire trio__wire--hi" />
      <line x1="6" y1="64" x2="48" y2="64" className="trio__wire trio__wire--hi" />
      {/* AND D-shape */}
      <path
        d="M48 18 H86 a30 30 0 0 1 0 60 H48 Z"
        className="trio__gatebody"
      />
      {/* output wire — HIGH */}
      <line x1="116" y1="48" x2="154" y2="48" className="trio__wire trio__wire--signal" />
      <circle cx="154" cy="48" r="4.5" className="trio__node--signal" />
      <text x="64" y="53" className="trio__gatelabel">&amp;</text>
    </svg>
  );
}

function Pillar({ glyph, title, body }: { glyph: string; title: string; body: string }): ReactElement {
  return (
    <article className="pillar">
      <span className="pillar__glyph" aria-hidden="true">{glyph}</span>
      <h2 className="pillar__title">{title}</h2>
      <p className="pillar__body">{body}</p>
    </article>
  );
}

/** Soft atmospheric indigo/cyan radial field behind the hero (depth, not chrome). */
function BrandField(): ReactElement {
  return <div className="landing__field" aria-hidden="true" />;
}
