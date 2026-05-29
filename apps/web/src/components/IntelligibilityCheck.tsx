import { type ReactElement } from 'react';

/**
 * The intelligibility sampling prompt (ADR-011 counter-metric 2). After a fraction of
 * component mounts, the learner is asked "Did that change make sense?" with a
 * yes/no/skip answer; the answer is emitted as an `intelligibility_response` beacon
 * the agent persists for the intelligibility metric.
 *
 * It is intentionally small + self-contained, with the app-wide a11y primitives the
 * global stylesheet promises: an `aria-live` region so assistive tech announces the
 * prompt, real buttons (keyboard-focusable), and a visually-hidden legend.
 */

/** The 1-in-3 sampling gate, factored out + RNG-injectable so it is DETERMINISTIC
 *  under test (a seeded RNG). Sampling ~1/3 of mounts keeps the prompt from nagging
 *  while still gathering enough answers to clear MIN_N over a session. */
const SAMPLE_RATE = 1 / 3;
export function shouldSampleIntelligibility(rng: () => number = Math.random): boolean {
  return rng() < SAMPLE_RATE;
}

export type IntelligibilityAnswer = 'yes' | 'no' | 'skip';

export function IntelligibilityCheck({
  mountedKind,
  onAnswer,
}: {
  /** The component kind being rated (echoed back on the beacon). */
  mountedKind: string;
  onAnswer: (answer: IntelligibilityAnswer) => void;
}): ReactElement {
  return (
    <aside className="intelligibility-check" aria-live="polite" data-mounted-kind={mountedKind}>
      <span className="visually-hidden">Quick check about the latest change.</span>
      <p className="intelligibility-check__prompt">Did that change make sense?</p>
      <div className="intelligibility-check__actions">
        <button type="button" onClick={() => onAnswer('yes')}>
          Yes
        </button>
        <button type="button" onClick={() => onAnswer('no')}>
          No
        </button>
        <button type="button" onClick={() => onAnswer('skip')}>
          Skip
        </button>
      </div>
    </aside>
  );
}
