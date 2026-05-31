import { type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { introForLesson } from '../lessonIntroContent.js';
import './overview.css';

/**
 * The per-lesson overview (`/learn`) — the calm bridge between the landing page and
 * the live lesson. It sets expectations (what this lesson is, the three forms you'll
 * work in, and how mastery is gated) BEFORE any session or WebSocket starts. Clicking
 * "Begin lesson" navigates to the lesson shell (`/lesson`), which is the only place
 * the session + socket are created (locked decision: start-on-begin).
 *
 * On-brand per docs/BRAND.md; spectrum gradient stays reserved for mastery.
 */

interface LessonMeta {
  /** What the learner will be able to do — short, concrete outcomes. */
  outcomes: string[];
}

const LESSON_META: Record<number, LessonMeta> = {
  1: {
    outcomes: [
      'Read and complete a truth table for AND, OR and NOT',
      'Wire a gate circuit and pulse the signal through it',
      'Write the matching line of pseudocode — and see all three agree',
    ],
  },
  2: {
    outcomes: [
      'Read and build nested expressions like (A AND B) OR (NOT C)',
      'Recognise XOR — "exactly one input true" — as something you compose, not a new gate',
      'Wire and write composed logic across all three forms',
    ],
  },
  3: {
    outcomes: [
      'Build NOT, AND, and OR using only NAND gates',
      'Explain why a single NAND gate can express any Boolean function',
      'Construct a NAND-only circuit for a given truth table',
    ],
  },
  4: {
    outcomes: [
      "Apply De Morgan's law: flip the negation AND the connective together",
      'Avoid the halfway-application trap — negating variables but leaving the operator unchanged',
      'Show NOT(A AND B) = (NOT A) OR (NOT B) across all three forms',
    ],
  },
};

/** Truth-table icon: a small 2-column grid mark. */
function IconTruthTable(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* outer border */}
      <rect x="3" y="3" width="18" height="18" rx="2" />
      {/* vertical divider */}
      <line x1="12" y1="3" x2="12" y2="21" />
      {/* horizontal header divider */}
      <line x1="3" y1="9" x2="21" y2="9" />
      {/* two data rows */}
      <line x1="3" y1="15" x2="21" y2="15" />
    </svg>
  );
}

/** Circuit icon: ANSI AND-gate D-shape with input stubs and an output stub. */
function IconCircuit(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* AND-gate body: flat back at x=5, semicircular front */}
      <path d="M5 6 L5 18 L11 18 Q19 18 19 12 Q19 6 11 6 Z" />
      {/* input stubs — top and bottom left */}
      <line x1="2" y1="9" x2="5" y2="9" />
      <line x1="2" y1="15" x2="5" y2="15" />
      {/* output stub — right */}
      <line x1="19" y1="12" x2="22" y2="12" />
    </svg>
  );
}

/** Pseudocode icon: a prompt cursor mark (two code lines with a leading angle). */
function IconPseudocode(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* chevron prompt › */}
      <polyline points="4,9 8,12 4,15" />
      {/* two code lines */}
      <line x1="11" y1="9" x2="20" y2="9" />
      <line x1="11" y1="15" x2="17" y2="15" />
    </svg>
  );
}

/** The three irreducible representations with inline SVG icons. */
const REPS: Array<{ icon: ReactElement; label: string; blurb: string }> = [
  {
    icon: <IconTruthTable />,
    label: 'Truth table',
    blurb: 'A grid of toggles — flip inputs, watch the result column light up.',
  },
  {
    icon: <IconCircuit />,
    label: 'Circuit',
    blurb: 'Canonical gate shapes you wire together, then pulse to see the signal flow.',
  },
  {
    icon: <IconPseudocode />,
    label: 'Pseudocode',
    blurb: 'A friendly line of code — the same logic, written out.',
  },
];

export function Overview(): ReactElement {
  const navigate = useNavigate();
  const lessonId = 1; // I1: the curriculum entry point is always Lesson 1.
  const intro = introForLesson(lessonId);
  const meta = LESSON_META[lessonId] ?? { outcomes: [] };

  return (
    <div className="overview">
      <header className="overview__top">
        <Link to="/" className="overview__brand" aria-label="Polymath home">
          <span className="brand-mark" aria-hidden="true">◑</span>
          <span className="overview__brand-name">Polymath</span>
        </Link>
        <Link to="/" className="overview__back">← Home</Link>
      </header>

      <main className="overview__main">
        <div className="overview__hero">
          <p className="eyebrow overview__eyebrow">Lesson {lessonId} of 4 · ~10 min</p>
          <h1 className="overview__title">{intro.title.replace(/^Lesson \d+ — /, '')}</h1>
          <p className="overview__lede">{intro.body}</p>
          <div className="overview__cta-row">
            <button
              type="button"
              className="btn btn--cta"
              onClick={() => navigate('/lesson')}
            >
              Begin lesson
              <span className="btn__arrow" aria-hidden="true">→</span>
            </button>
            <span className="overview__cta-note">Voice tutor optional · your data stays private</span>
          </div>
        </div>

        <section className="overview__reps" aria-label="The three representations">
          {REPS.map((r) => (
            <article key={r.label} className="rep-card card card--interactive">
              <span className="glyph-chip" aria-hidden="true">{r.icon}</span>
              <h2 className="rep-card__label">{r.label}</h2>
              <p className="rep-card__blurb">{r.blurb}</p>
            </article>
          ))}
        </section>

        <div className="overview__cols">
          <section className="overview__panel card" aria-labelledby="ov-outcomes">
            <h2 id="ov-outcomes" className="overview__panel-title">By the end you can</h2>
            <ul className="overview__outcomes">
              {meta.outcomes.map((o) => (
                <li key={o}><span className="overview__tick" aria-hidden="true">✓</span>{o}</li>
              ))}
            </ul>
          </section>

          <section className="overview__panel overview__panel--gate card" aria-labelledby="ov-gate">
            <h2 id="ov-gate" className="overview__panel-title">How mastery is earned</h2>
            <p className="overview__gate-lead">
              Polymath only declares you a master when you genuinely can&rsquo;t be
              guessing. Every condition must hold:
            </p>
            <ul className="overview__gate-list">
              <li><strong>Fluent across all three forms</strong>, not just one.</li>
              <li><strong>Correct on your own</strong> — no hints, in a natural time band.</li>
              <li><strong>A held-out transfer item</strong> you haven&rsquo;t seen.</li>
              <li><strong>A spoken explain-back</strong> in your own words.</li>
            </ul>
            <p className="overview__gate-foot">
              Clear it and you&rsquo;ll see the one celebration we reserve for it.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
