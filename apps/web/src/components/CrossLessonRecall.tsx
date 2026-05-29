import type { ReactElement } from 'react';
import type { ComponentSpec } from '@polymath/contract';

type CrossLessonRecallSpec = Extract<ComponentSpec, { kind: 'CrossLessonRecall' }>;

/**
 * F-14 — cross-lesson recall card (ADR-012 cross-lesson value).
 *
 * A short, TEXT-ONLY callout the SERVER reflex mounts when the learner regresses
 * on a prior-lesson (L1) KC mid-L2: "You mastered NOT in Lesson 1 — here's how NOT
 * shows up in this composed expression." It names the specific KC (AC#2) and shows
 * a brief reminder, with a "got it, continue" button that resumes the practice
 * flow at the current item (AC#3).
 *
 * TEXT-ONLY by design (the probe-integrity boundary): it renders NO rep workspace
 * (truth table / circuit / pseudocode) and has NO `visibleReps` field, so a recall
 * card can never expose a held-out transfer-probe rep. Modeled on `HintCard`
 * (`role="note"`, `data-kc`).
 */
export function CrossLessonRecall({
  spec,
  onDismiss,
}: {
  spec: CrossLessonRecallSpec;
  /** Resume the practice flow at the current item. Called with `spec.currentItemId`. */
  onDismiss?: (currentItemId: string) => void;
}): ReactElement {
  return (
    <aside
      className="cross-lesson-recall"
      data-kc={spec.kc}
      role="note"
      aria-label={`Cross-lesson recall: ${spec.kc}`}
    >
      <span className="cross-lesson-recall__label">
        You mastered <strong>{spec.kc}</strong> in Lesson 1
      </span>
      <p className="cross-lesson-recall__body">{spec.reminderBody}</p>
      <button
        type="button"
        className="cross-lesson-recall__dismiss"
        onClick={() => onDismiss?.(spec.currentItemId)}
      >
        Got it, continue
      </button>
    </aside>
  );
}
