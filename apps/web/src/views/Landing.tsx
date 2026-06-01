import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import './landing.css';
import { InteractiveHero } from './landing/InteractiveHero.js';
import { SignalField } from './landing/SignalField.js';

/**
 * The Polymath landing page — the apex marketing surface at `/`.
 *
 * Direction: "The Living Substrate" (bold reinvention, frontend-design skill).
 * The interactive A·B demo is no longer a widget parked below a copy column —
 * it is the HERO. A live circuit substrate (SignalField) breathes behind the
 * whole page; the oversized headline and the live AND-gate share one continuous
 * composition so "one idea, three forms" is *felt* before a word is read. The
 * three representations read left→right as a SIGNAL BUS: table → circuit → code,
 * the signal propagating across the page.
 *
 * Brand-anchored (docs/BRAND.md): deep indigo-navy ink, cyan + indigo accents,
 * signal-green reserved for HIGH/true, Poppins display over Karla body, JetBrains
 * Mono for logic notation. The signature spectrum gradient stays reserved for the
 * mastery-celebration moment — never used as chrome here.
 *
 * Pure static brand surface: no session, no WebSocket. The lesson session only
 * starts when the learner clicks Begin on the overview (`/learn`).
 */
export function Landing(): ReactElement {
  return (
    <div className="landing">
      <SignalField />

      <header className="landing__top">
        <div className="landing__brand">
          <span className="brand-mark" aria-hidden="true">◑</span>
          <span className="landing__brand-name">Polymath</span>
        </div>
        <Link to="/learn" className="btn btn--ghost landing__top-cta">
          Start learning
        </Link>
      </header>

      <main className="landing__main">
        {/* ── Hero: the headline + the live demo are ONE composition ── */}
        <section className="landing__hero" aria-label="Polymath — master Boolean logic">
          <div className="landing__hero-copy">
            <p className="eyebrow landing__eyebrow">Mastery-grade Boolean logic</p>
            <h1 className="landing__headline">
              The&nbsp;logic&nbsp;behind
              <br />
              <span className="landing__headline-accent">everything.</span>
            </h1>
            <p className="landing__sub">
              AND, OR and NOT are the whole alphabet of logic — the foundation of
              every circuit, condition, and line of code. Master them for real across{' '}
              <strong>truth tables</strong>, <strong>circuits</strong> you can wire and
              pulse, and <strong>code</strong>.
            </p>
            <div className="landing__cta-row">
              <Link to="/learn" className="btn btn--cta">
                Begin Lesson 1
                <span className="btn__arrow" aria-hidden="true">→</span>
              </Link>
              <span className="landing__cta-note">No account · ~10&nbsp;min · free</span>
            </div>
          </div>

          {/* The live, hyperresponsive product preview — the centerpiece. */}
          <div className="landing__hero-demo">
            <InteractiveHero />
          </div>
        </section>

        <section className="landing__pillars" aria-label="How mastery is earned">
          <Pillar
            icon={<TrioIcon />}
            title="See it three ways"
            body="Every concept arrives as a truth table, a gate circuit, and pseudocode at once — bound together so one action lights up the same idea in all three."
          />
          <Pillar
            icon={<PulseIcon />}
            title="Practice that responds"
            body="Toggle a cell, wire a gate, write a line — the interface marks you right the instant you act. No waiting, no page reloads. It feels alive."
            green
          />
          <Pillar
            icon={<MasteryIcon />}
            title="Mastery you can't fake"
            body="The gate is strict on purpose: held-out transfer items and a spoken explain-back mean a “mastered” learner can't have been pattern-matching or pasting answers."
          />
        </section>

        <section className="landing__strip">
          <div className="landing__strip-head">
            <h2 className="eyebrow landing__strip-lead">The curriculum</h2>
            <Link to="/learn" className="landing__strip-cta">
              Start with Lesson&nbsp;1
              <span aria-hidden="true">→</span>
            </Link>
          </div>
          <ol className="landing__lessons">
            <li><span className="landing__lesson-n">1</span> Basic operators</li>
            <li><span className="landing__lesson-n">2</span> Composition &amp; XOR</li>
            <li><span className="landing__lesson-n">3</span> NAND universality</li>
            <li><span className="landing__lesson-n">4</span> De&nbsp;Morgan&rsquo;s law</li>
          </ol>
        </section>
      </main>

      <footer className="landing__footer">
        <span className="brand-mark brand-mark--sm" aria-hidden="true">◑</span>
        <span>Polymath — a multimodal mastery interface for Boolean logic.</span>
      </footer>
    </div>
  );
}

// ── Pillar card ──────────────────────────────────────────────────────────────

function Pillar({
  icon,
  title,
  body,
  green = false,
}: {
  icon: ReactElement;
  title: string;
  body: string;
  green?: boolean;
}): ReactElement {
  return (
    <article className="pillar card card--interactive">
      <span className={`glyph-chip${green ? ' glyph-chip--signal' : ''}`} aria-hidden="true">
        {icon}
      </span>
      <h3 className="pillar__title">{title}</h3>
      <p className="pillar__body">{body}</p>
    </article>
  );
}

/** Trio mark — three tiny forms: table grid, D-gate, code bracket. */
function TrioIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* 2×2 table grid */}
      <rect x="2" y="2" width="8" height="8" rx="1" />
      <line x1="6" y1="2" x2="6" y2="10" />
      <line x1="2" y1="6" x2="10" y2="6" />
      {/* AND gate D-shape (right side) */}
      <path d="M14 4 H18 a4 4 0 0 1 0 8 H14 Z" />
      {/* Code bracket (bottom left) */}
      <polyline points="3,15 2,18 3,21" />
      <polyline points="9,15 10,18 9,21" />
      {/* Dot in bracket center */}
      <line x1="5" y1="18" x2="7" y2="18" />
    </svg>
  );
}

/** Pulse icon — a horizontal wire with a signal dot: "practice that responds". */
function PulseIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      {/* Wire baseline */}
      <line x1="2" y1="12" x2="8" y2="12" />
      {/* Signal pulse (square wave) */}
      <polyline points="8,12 8,6 13,6 13,12" />
      <line x1="13" y1="12" x2="22" y2="12" />
      {/* Filled signal dot at the active point */}
      <circle cx="13" cy="6" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Mastery icon — the ◑ brand half-circle mark as an SVG. */
function MasteryIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* Full circle outline */}
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      {/* Left half filled — the brand ◑ logotype */}
      <path d="M12 3 A9 9 0 0 0 12 21 Z" fill="currentColor" />
    </svg>
  );
}
