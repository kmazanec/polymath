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
};

/** The three irreducible representations, named with their brand glyphs. */
const REPS: Array<{ glyph: string; label: string; blurb: string }> = [
  { glyph: '▦', label: 'Truth table', blurb: 'A grid of toggles — flip inputs, watch the result column light up.' },
  { glyph: '⏚', label: 'Circuit', blurb: 'Canonical gate shapes you wire together, then pulse to see the signal flow.' },
  { glyph: '›_', label: 'Pseudocode', blurb: 'A friendly line of code — the same logic, written out.' },
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
          <span className="overview__brand-mark" aria-hidden="true">◑</span>
          <span className="overview__brand-name">Polymath</span>
        </Link>
        <Link to="/" className="overview__back">← Home</Link>
      </header>

      <main className="overview__main">
        <div className="overview__hero">
          <p className="overview__eyebrow">Lesson {lessonId} of 4 · ~10 min</p>
          <h1 className="overview__title">{intro.title.replace(/^Lesson \d+ — /, '')}</h1>
          <p className="overview__lede">{intro.body}</p>
          <div className="overview__cta-row">
            <button
              type="button"
              className="overview__begin"
              onClick={() => navigate('/lesson')}
            >
              Begin lesson
              <span className="overview__begin-arrow" aria-hidden="true">→</span>
            </button>
            <span className="overview__cta-note">Voice tutor optional · your data stays private</span>
          </div>
        </div>

        <section className="overview__reps" aria-label="The three representations">
          {REPS.map((r) => (
            <article key={r.label} className="rep-card">
              <span className="rep-card__glyph" aria-hidden="true">{r.glyph}</span>
              <h2 className="rep-card__label">{r.label}</h2>
              <p className="rep-card__blurb">{r.blurb}</p>
            </article>
          ))}
          <span className="overview__reps-link" aria-hidden="true">+</span>
        </section>

        <div className="overview__cols">
          <section className="overview__panel" aria-labelledby="ov-outcomes">
            <h2 id="ov-outcomes" className="overview__panel-title">By the end you can</h2>
            <ul className="overview__outcomes">
              {meta.outcomes.map((o) => (
                <li key={o}><span className="overview__tick" aria-hidden="true">✓</span>{o}</li>
              ))}
            </ul>
          </section>

          <section className="overview__panel overview__panel--gate" aria-labelledby="ov-gate">
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
